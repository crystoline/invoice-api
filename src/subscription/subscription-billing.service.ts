import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, plans, subscriptions } from '@prisma/client';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackService } from '../payment/paystack.service';
import { StripeService } from '../payment/stripe.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { CheckoutDto } from './dto/subscription.dto';
import {
  BILLING,
  BillingInterval,
  Gateway,
  addInterval,
  asText,
  jurisdictionOf,
  parseInterval,
  toMinor,
} from './jurisdiction';

/** A Paystack webhook event (only the fields we read). */
export interface PaystackEvent {
  event?: string;
  data?: {
    reference?: string;
    amount?: number;
    currency?: string;
    metadata?: unknown;
    customer?: { id?: number; email?: string; customer_code?: string };
    authorization?: { authorization_code?: string; reusable?: boolean };
    plan?: { plan_code?: string } | null;
    subscription_code?: string;
    email_token?: string;
    next_payment_date?: string | null;
    subscription?: { subscription_code?: string };
  };
}

interface SubscriptionMeta {
  kind?: string;
  userId?: string;
  planId?: string;
  interval?: string;
  /** Paystack: the plan its renewals run on. */
  planCode?: string;
  /** ISO date the paid period starts — the end of the trial being paid for. */
  startAt?: string;
}

/** A future date from metadata, or null. */
const futureDate = (iso: unknown, now = new Date()): Date | null => {
  const d = new Date(asText(iso));
  return Number.isNaN(d.getTime()) || d <= now ? null : d;
};

/** Stripe Checkout only accepts a trial ending at least 48 hours out. */
const STRIPE_MIN_TRIAL_MS = 49 * 60 * 60 * 1000;

/** Paystack may echo metadata back as a JSON string. */
const parseMeta = (raw: unknown): SubscriptionMeta => {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as SubscriptionMeta;
    } catch {
      return {};
    }
  }
  return raw;
};

const asId = (v: unknown): bigint | null =>
  /^\d+$/.test(asText(v)) ? BigInt(asText(v)) : null;

/**
 * Paid subscriptions: checkout in the user's jurisdiction (Paystack for NGN,
 * Stripe for USD), then the gateway bills every period automatically and its
 * webhooks keep our subscription in step. Webhook handling is idempotent and
 * tolerates events arriving in any order.
 */
@Injectable()
export class SubscriptionBillingService {
  private readonly logger = new Logger(SubscriptionBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly paystack: PaystackService,
    private readonly stripe: StripeService,
  ) {}

  // ---- checkout -------------------------------------------------------------

  async checkout(dto: CheckoutDto, user: AuthUser): Promise<ResponseObject> {
    const interval = parseInterval(dto.interval);
    if (!interval) return fail('Choose monthly or yearly billing.');
    if (dto.planId == null) return fail('planId is required.');

    const dbUser = await this.prisma.users.findUnique({
      where: { id: user.id },
    });
    const jurisdiction = jurisdictionOf(dbUser?.country);
    if (!dbUser || !jurisdiction)
      return fail('Choose your billing country first.');
    if (!dbUser.email) return fail('Your account has no email address.');

    const plan = await this.prisma.plans.findUnique({
      where: { id: BigInt(dto.planId) },
    });
    if (
      !plan ||
      !plan.is_active ||
      plan.jurisdiction !== (jurisdiction as string)
    )
      return fail("This plan isn't available in your region.");

    const price =
      interval === 'YEARLY' ? plan.price_yearly : plan.price_monthly;
    if (!price || price <= 0)
      return fail('This plan is free — no payment needed.');

    const { currency, gateway } = BILLING[jurisdiction];
    const amountMinor = toMinor(price);
    const returnUrl = `${this.frontendUrl()}/dashboard/settings/subscription`;
    const metadata: Record<string, string> = {
      kind: 'subscription',
      userId: String(user.id),
      planId: String(plan.id),
      interval,
    };
    // Paying during a trial keeps the days left: the paid period starts when
    // the trial ends. Stripe saves the card and charges then; Paystack can't
    // defer a first charge, so it charges now for the period after the trial.
    let startAt = await this.unusedTrialEnd(user.id);

    try {
      let checkoutUrl: string;
      if (gateway === 'PAYSTACK') {
        if (!this.paystack.configured)
          return fail(
            "Naira payments aren't available right now. Please try again later.",
          );
        const planCode = await this.ensurePaystackPlan(
          plan,
          interval,
          amountMinor,
          currency,
        );
        checkoutUrl = await this.paystack.initializeCardPayment({
          email: dbUser.email,
          amountMinor,
          currency,
          callbackUrl: `${returnUrl}?checkout=success`,
          metadata: {
            ...metadata,
            planCode,
            ...(startAt && { startAt: startAt.toISOString() }),
          },
        });
      } else {
        if (!this.stripe.configured)
          return fail(
            "Card payments aren't available right now. Please try again later.",
          );
        if (startAt)
          startAt = new Date(
            Math.max(startAt.getTime(), Date.now() + STRIPE_MIN_TRIAL_MS),
          );
        checkoutUrl = await this.stripe.createSubscriptionCheckout({
          email: dbUser.email,
          productName: plan.display_name ?? plan.name,
          amountMinor,
          currency,
          interval: interval === 'YEARLY' ? 'year' : 'month',
          successUrl: `${returnUrl}?checkout=success`,
          cancelUrl: `${returnUrl}?checkout=cancelled`,
          metadata: {
            ...metadata,
            ...(startAt && { startAt: startAt.toISOString() }),
          },
          trialEnd: startAt ?? undefined,
        });
      }
      return ok('Continue to checkout', {
        checkoutUrl,
        gateway,
        currency,
        amount: price,
        interval,
        periodStartsAt: startAt,
      });
    } catch (e) {
      this.logger.error(`Checkout failed: ${(e as Error).message}`);
      return fail("Couldn't start checkout. Please try again.");
    }
  }

  /** The Paystack plan for this price, created on first use. */
  private async ensurePaystackPlan(
    plan: plans,
    interval: BillingInterval,
    amountMinor: number,
    currency: string,
  ): Promise<string> {
    const key = {
      plan_id: plan.id,
      gateway: 'PAYSTACK',
      billing_interval: interval,
      amount_minor: amountMinor,
      currency,
    };
    const existing = await this.prisma.gateway_plans.findFirst({ where: key });
    if (existing) return existing.gateway_plan_code;
    const code = await this.paystack.createPlan({
      name: `${plan.display_name ?? plan.name} (${interval.toLowerCase()}, ${currency})`,
      amountMinor,
      interval: interval === 'YEARLY' ? 'annually' : 'monthly',
      currency,
    });
    try {
      await this.prisma.gateway_plans.create({
        data: { ...key, gateway_plan_code: code },
      });
      return code;
    } catch {
      // A concurrent checkout stored one first — use that.
      const row = await this.prisma.gateway_plans.findFirst({ where: key });
      return row?.gateway_plan_code ?? code;
    }
  }

  /**
   * When the trial being paid for ends; null when not on one. A Stripe
   * subscription that hasn't charged the card yet is still in that trial, so
   * switching plans from it keeps the days too.
   */
  private async unusedTrialEnd(userId: bigint): Promise<Date | null> {
    const current = await this.prisma.subscriptions.findFirst({
      where: { user_id: userId, is_active: true, end_date: { gt: new Date() } },
      orderBy: { start_date: 'desc' },
    });
    if (!current) return null;
    const onTrial = current.status === 'TRIAL' && !current.payment_gateway;
    const cardNotYetCharged =
      current.payment_gateway === 'STRIPE' && !current.last_payment_date;
    return onTrial || cardNotYetCharged ? current.end_date : null;
  }

  // ---- cancellation ---------------------------------------------------------

  /** Stop the gateway billing a subscription (no-op for trials / free plans). */
  async cancelAtGateway(
    sub: subscriptions,
    atPeriodEnd: boolean,
  ): Promise<void> {
    if (sub.payment_gateway === 'STRIPE' && sub.gateway_subscription_id) {
      await this.stripe.cancelSubscription(
        sub.gateway_subscription_id,
        atPeriodEnd,
      );
    }
    if (sub.payment_gateway === 'PAYSTACK') {
      const linked = await this.linkPaystackSubscription(sub);
      if (!linked.gateway_subscription_id || !linked.gateway_token) {
        throw new Error('Paystack subscription not found');
      }
      // Paystack has no "at period end": disabling stops future charges, and
      // access already paid for runs to end_date either way.
      await this.paystack.disableSubscription(
        linked.gateway_subscription_id,
        linked.gateway_token,
      );
    }
  }

  // ---- Paystack webhooks ----------------------------------------------------

  async handlePaystackEvent(event: PaystackEvent): Promise<void> {
    const d = event.data ?? {};
    switch (event.event) {
      case 'charge.success':
        return this.onPaystackCharge(d);
      case 'subscription.create':
        return this.onPaystackSubscriptionCreated(d);
      case 'invoice.payment_failed':
        return this.updateByGatewayId(
          'PAYSTACK',
          d.subscription?.subscription_code,
          {
            status: 'PAST_DUE',
          },
        );
      case 'subscription.not_renew':
        return this.updateByGatewayId('PAYSTACK', d.subscription_code, {
          auto_renew: false,
          is_cancelled: true,
          status: 'CANCELLED',
        });
      case 'subscription.disable':
        return this.updateByGatewayId('PAYSTACK', d.subscription_code, {
          auto_renew: false,
          is_cancelled: true,
          status: 'CANCELLED',
        });
      default:
        return;
    }
  }

  private async onPaystackCharge(d: NonNullable<PaystackEvent['data']>) {
    const reference = d.reference;
    if (!reference) return;
    if (await this.paymentExists(reference)) return; // already processed
    const amount = (d.amount ?? 0) / 100;
    const currency = (d.currency ?? 'NGN').toUpperCase();
    const meta = parseMeta(d.metadata);

    if (meta.kind === 'subscription') {
      // First period of a new subscription (our checkout's one-off charge).
      // It runs from the end of the trial being paid for, if any, else now.
      const userId = asId(meta.userId);
      const planId = asId(meta.planId);
      const interval = parseInterval(meta.interval);
      if (!userId || !planId || !interval) return;
      const sub = await this.activate({
        userId,
        planId,
        interval,
        gateway: 'PAYSTACK',
        customerId: d.customer?.customer_code ?? null,
        endDate: addInterval(futureDate(meta.startAt) ?? new Date(), interval),
        chargedNow: true,
      });
      await this.recordPayment(sub.id, amount, currency, 'PAYSTACK', reference);
      await this.startPaystackRenewals(sub, meta.planCode, d.authorization);
      return;
    }

    // A renewal charge Paystack made for one of our plans.
    const planCode = d.plan?.plan_code;
    if (!planCode || !d.customer?.email) return; // not a subscription charge
    const sub = await this.findPaystackSubscription(d.customer.email, planCode);
    if (!sub) {
      this.logger.warn(
        `Paystack renewal ${reference}: no matching subscription`,
      );
      return;
    }
    await this.recordPayment(sub.id, amount, currency, 'PAYSTACK', reference);
    await this.extend(sub);
  }

  /**
   * Renewals run on a Paystack subscription that charges the saved card when
   * the paid period ends. Without one, the plan simply won't renew.
   */
  private async startPaystackRenewals(
    sub: subscriptions,
    planCode: string | undefined,
    card: NonNullable<PaystackEvent['data']>['authorization'],
  ): Promise<void> {
    try {
      if (!planCode || !sub.gateway_customer_id)
        throw new Error('missing plan or customer');
      if (!card?.authorization_code || card.reusable === false)
        throw new Error('the card used cannot be charged again');
      const remote = await this.paystack.createSubscription({
        customer: sub.gateway_customer_id,
        planCode,
        authorization: card.authorization_code,
        startDate: sub.end_date,
      });
      await this.prisma.subscriptions.update({
        where: { id: sub.id },
        data: {
          gateway_subscription_id: remote.subscription_code,
          gateway_token: remote.email_token,
        },
      });
    } catch (e) {
      this.logger.error(
        `Subscription ${sub.id} won't renew automatically: ${(e as Error).message}`,
      );
      await this.prisma.subscriptions.update({
        where: { id: sub.id },
        data: { auto_renew: false },
      });
    }
  }

  private async onPaystackSubscriptionCreated(
    d: NonNullable<PaystackEvent['data']>,
  ) {
    if (!d.subscription_code || !d.plan?.plan_code || !d.customer?.email)
      return;
    const sub = await this.findPaystackSubscription(
      d.customer.email,
      d.plan.plan_code,
    );
    // Not activated yet, or already linked by startPaystackRenewals?
    if (!sub || sub.gateway_subscription_id) return;
    await this.prisma.subscriptions.update({
      where: { id: sub.id },
      data: {
        // Our create call failed but Paystack made the subscription anyway.
        auto_renew: !sub.is_cancelled,
        gateway_subscription_id: d.subscription_code,
        gateway_token: d.email_token ?? null,
        next_payment_date: d.next_payment_date
          ? new Date(d.next_payment_date)
          : undefined,
      },
    });
  }

  /** Our current Paystack subscription for this customer email + plan code. */
  private async findPaystackSubscription(email: string, planCode: string) {
    const gp = await this.prisma.gateway_plans.findFirst({
      where: { gateway: 'PAYSTACK', gateway_plan_code: planCode },
    });
    const user = await this.prisma.users.findFirst({ where: { email } });
    if (!gp || !user) return null;
    return this.prisma.subscriptions.findFirst({
      where: {
        user_id: user.id,
        plan_id: gp.plan_id,
        payment_gateway: 'PAYSTACK',
        is_active: true,
      },
      orderBy: { start_date: 'desc' },
    });
  }

  /** Fill in the Paystack subscription code + email token (needed to cancel). */
  private async linkPaystackSubscription(
    sub: subscriptions,
  ): Promise<subscriptions> {
    if (sub.gateway_subscription_id && sub.gateway_token) return sub;
    if (!sub.gateway_customer_id) return sub;
    const codes = await this.prisma.gateway_plans.findMany({
      where: { plan_id: sub.plan_id, gateway: 'PAYSTACK' },
      select: { gateway_plan_code: true },
    });
    const ours = new Set(codes.map((c) => c.gateway_plan_code));
    const remote = (
      await this.paystack.listSubscriptions(sub.gateway_customer_id)
    ).find((s) => s.status === 'active' && ours.has(s.plan?.plan_code ?? ''));
    if (!remote) return sub;
    return this.prisma.subscriptions.update({
      where: { id: sub.id },
      data: {
        gateway_subscription_id: remote.subscription_code,
        gateway_token: remote.email_token,
        next_payment_date: remote.next_payment_date
          ? new Date(remote.next_payment_date)
          : undefined,
      },
    });
  }

  // ---- Stripe webhooks ------------------------------------------------------

  async handleStripeEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        if (s.mode !== 'subscription' || typeof s.subscription !== 'string')
          return;
        await this.activateFromStripe(
          s.subscription,
          s.metadata ?? {},
          this.idOf(s.customer),
        );
        return;
      }
      case 'invoice.paid': {
        const inv = event.data.object as Stripe.Invoice & {
          subscription?: string | { id: string } | null;
          parent?: {
            subscription_details?: { subscription?: string | { id: string } };
          };
        };
        const subId =
          this.idOf(inv.subscription) ??
          this.idOf(inv.parent?.subscription_details?.subscription);
        if (!subId || !inv.id) return;
        let sub = await this.byGatewayId('STRIPE', subId);
        if (!sub) {
          // invoice.paid can arrive before checkout.session.completed.
          const remote = await this.stripe.retrieveSubscription(subId);
          sub = await this.activateFromStripe(
            subId,
            remote.metadata,
            this.idOf(remote.customer),
          );
        }
        if (!sub) return;
        if (!inv.amount_paid) return; // the $0 invoice that opens a trial
        const periodEnd = inv.lines?.data?.[0]?.period?.end;
        const recorded = await this.recordPayment(
          sub.id,
          (inv.amount_paid ?? 0) / 100,
          (inv.currency ?? 'usd').toUpperCase(),
          'STRIPE',
          inv.id,
        );
        if (recorded)
          await this.extend(
            sub,
            periodEnd ? new Date(periodEnd * 1000) : undefined,
          );
        return;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice & {
          subscription?: string | { id: string } | null;
          parent?: {
            subscription_details?: { subscription?: string | { id: string } };
          };
        };
        const subId =
          this.idOf(inv.subscription) ??
          this.idOf(inv.parent?.subscription_details?.subscription);
        return this.updateByGatewayId('STRIPE', subId ?? undefined, {
          status: 'PAST_DUE',
        });
      }
      case 'customer.subscription.updated': {
        const s = event.data.object;
        const data: Prisma.subscriptionsUpdateInput = {
          auto_renew: !s.cancel_at_period_end,
        };
        if (s.cancel_at_period_end)
          Object.assign(data, { is_cancelled: true, status: 'CANCELLED' });
        else if (s.status === 'past_due' || s.status === 'unpaid')
          data.status = 'PAST_DUE';
        else if (s.status === 'active')
          Object.assign(data, { is_cancelled: false, status: 'ACTIVE' });
        return this.updateByGatewayId('STRIPE', s.id, data);
      }
      case 'customer.subscription.deleted':
        return this.updateByGatewayId('STRIPE', event.data.object.id, {
          status: 'EXPIRED',
          is_active: false,
          auto_renew: false,
        });
      default:
        return;
    }
  }

  private idOf(v: unknown): string | null {
    if (!v) return null;
    if (typeof v === 'string') return v;
    const id = (v as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }

  private async activateFromStripe(
    subscriptionId: string,
    metadata: Record<string, string>,
    customerId: string | null,
  ) {
    const userId = asId(metadata.userId);
    const planId = asId(metadata.planId);
    const interval = parseInterval(metadata.interval);
    if (!userId || !planId || !interval) return null;
    // Paid during a trial: the card is charged when the trial ends, and
    // invoice.paid then moves the period on. Otherwise it was charged now.
    const trialEnd = futureDate(metadata.startAt);
    return this.activate({
      userId,
      planId,
      interval,
      gateway: 'STRIPE',
      gatewaySubscriptionId: subscriptionId,
      customerId,
      endDate: trialEnd ?? addInterval(new Date(), interval),
      chargedNow: !trialEnd,
    });
  }

  // ---- shared ---------------------------------------------------------------

  /**
   * Start (or find) the paid subscription a gateway confirmed, giving access
   * until `endDate`. Whatever the user had before — trial, free plan, or a
   * previous paid plan they are switching from — is retired; a previous
   * gateway subscription is stopped.
   */
  private async activate(p: {
    userId: bigint;
    planId: bigint;
    interval: BillingInterval;
    gateway: Gateway;
    gatewaySubscriptionId?: string;
    customerId?: string | null;
    endDate: Date;
    /** False when the card was saved for a charge at the end of a trial. */
    chargedNow: boolean;
  }): Promise<subscriptions> {
    if (p.gatewaySubscriptionId) {
      const existing = await this.byGatewayId(
        p.gateway,
        p.gatewaySubscriptionId,
      );
      if (existing) return existing;
    }
    const previous = await this.prisma.subscriptions.findMany({
      where: { user_id: p.userId, is_active: true },
    });
    for (const prev of previous) {
      if (
        prev.payment_gateway &&
        prev.gateway_subscription_id !== p.gatewaySubscriptionId
      ) {
        await this.cancelAtGateway(prev, false).catch((e: Error) =>
          this.logger.error(
            `Couldn't stop previous subscription ${prev.id}: ${e.message}`,
          ),
        );
      }
    }
    await this.prisma.subscriptions.updateMany({
      where: { user_id: p.userId, is_active: true },
      data: { is_active: false, status: 'REPLACED' },
    });
    const now = new Date();
    return this.prisma.subscriptions.create({
      data: {
        user_id: p.userId,
        plan_id: p.planId,
        status: 'ACTIVE',
        start_date: now,
        end_date: p.endDate,
        is_active: true,
        is_cancelled: false,
        auto_renew: true,
        payment_gateway: p.gateway,
        billing_interval: p.interval,
        gateway_subscription_id: p.gatewaySubscriptionId ?? null,
        gateway_customer_id: p.customerId ?? null,
        last_payment_date: p.chargedNow ? now : null,
        next_payment_date: p.endDate,
      },
    });
  }

  /** A renewal went through: push the paid period forward. */
  private async extend(sub: subscriptions, periodEnd?: Date): Promise<void> {
    const interval = parseInterval(sub.billing_interval) ?? 'MONTHLY';
    const now = new Date();
    const from = sub.end_date > now ? sub.end_date : now;
    const end =
      periodEnd && periodEnd > now ? periodEnd : addInterval(from, interval);
    await this.prisma.subscriptions.update({
      where: { id: sub.id },
      data: {
        status: sub.is_cancelled ? 'CANCELLED' : 'ACTIVE',
        is_active: true,
        end_date: end,
        next_payment_date: end,
        last_payment_date: now,
      },
    });
  }

  private paymentExists(reference: string) {
    return this.prisma.payments
      .findFirst({
        where: { transaction_ref: reference },
        select: { id: true },
      })
      .then((p) => !!p);
  }

  /** Record a subscription charge once; false if this reference was seen before. */
  private async recordPayment(
    subscriptionId: bigint,
    amount: number,
    currency: string,
    gateway: Gateway,
    reference: string,
  ): Promise<boolean> {
    if (await this.paymentExists(reference)) return false;
    await this.prisma.payments.create({
      data: {
        subscription_id: subscriptionId,
        amount,
        currency,
        method: gateway,
        transaction_ref: reference,
        status: 'SUCCESS',
        paid_at: new Date(),
      },
    });
    return true;
  }

  private byGatewayId(gateway: Gateway, id: string) {
    return this.prisma.subscriptions.findFirst({
      where: { payment_gateway: gateway, gateway_subscription_id: id },
    });
  }

  private async updateByGatewayId(
    gateway: Gateway,
    id: string | undefined,
    data: Prisma.subscriptionsUpdateInput,
  ): Promise<void> {
    if (!id) return;
    const sub = await this.byGatewayId(gateway, id);
    if (!sub || sub.status === 'EXPIRED' || sub.status === 'REPLACED') return;
    await this.prisma.subscriptions.update({ where: { id: sub.id }, data });
  }

  private frontendUrl(): string {
    return (
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');
  }
}
