import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, plans } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  SubscribeDto,
  ChangePlanDto,
  CountryDto,
} from './dto/subscription.dto';
import { SubscriptionBillingService } from './subscription-billing.service';
import {
  BILLING,
  Jurisdiction,
  daysFrom,
  jurisdictionOf,
  normalizeCountry,
} from './jurisdiction';
import {
  isFreePlan,
  isPaidAndCurrent,
  mapPlan,
  mapSubscription,
  subInclude,
} from './subscription.mapper';

const TRIAL_DAYS = 14;
/** Free plans don't lapse. */
const FREE_PLAN_YEARS = 100;
/** Grace after a missed renewal before access ends (gateways retry meanwhile). */
const GRACE_DAYS = 3;

/** Default catalogue: created only when there are no plans at all. */
const DEFAULT_TIERS = [
  {
    tier: 'free',
    name: 'Free',
    description: 'Get started with the essentials at no cost.',
    ngn: [0, 0],
    usd: [0, 0],
    limits: { invoices: 5, businesses: 1, team: 1 },
    features: {
      payments: false,
      recurring: false,
      templates: false,
      api: false,
    },
  },
  {
    tier: 'basic',
    name: 'Basic',
    description: 'For freelancers and small teams getting off the ground.',
    ngn: [5000, 50000],
    usd: [10, 100],
    limits: { invoices: 50, businesses: 2, team: 3 },
    features: { payments: true, recurring: true, templates: false, api: false },
  },
  {
    tier: 'professional',
    name: 'Professional',
    description:
      'For growing businesses that need more power and customization.',
    ngn: [15000, 150000],
    usd: [30, 300],
    limits: { invoices: 500, businesses: 5, team: 10 },
    features: { payments: true, recurring: true, templates: true, api: false },
  },
  {
    tier: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited scale with every feature and priority support.',
    ngn: [50000, 500000],
    usd: [100, 1000],
    limits: { invoices: null, businesses: null, team: null },
    features: { payments: true, recurring: true, templates: true, api: true },
  },
];

@Injectable()
export class SubscriptionService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: SubscriptionBillingService,
  ) {}

  /**
   * Seed the default catalogue — one plan per tier for each jurisdiction — but
   * only into an empty plans table. Admins own the plans after that; nothing
   * here overwrites their names, prices or limits.
   */
  async onModuleInit(): Promise<void> {
    if ((await this.prisma.plans.count()) > 0) return;
    for (const t of DEFAULT_TIERS) {
      for (const j of [Jurisdiction.NG, Jurisdiction.OTHER]) {
        const [monthly, yearly] = j === Jurisdiction.NG ? t.ngn : t.usd;
        await this.prisma.plans.create({
          data: {
            name: j === Jurisdiction.NG ? t.name : `${t.name} (USD)`,
            display_name: t.name,
            description: t.description,
            jurisdiction: j,
            currency: BILLING[j].currency,
            price_monthly: monthly,
            price_yearly: yearly,
            tier: t.tier,
            duration_in_days: 30,
            max_invoices_per_month: t.limits.invoices,
            max_businesses: t.limits.businesses,
            max_team_members: t.limits.team,
            allow_payment_collection: t.features.payments,
            allow_recurring_invoices: t.features.recurring,
            allow_custom_templates: t.features.templates,
            allow_api_access: t.features.api,
            is_active: true,
          },
        });
      }
    }
    this.logger.log('Seeded the default plan catalogue (NG + OTHER).');
  }

  /** The user's most recent subscription. */
  private currentSubscription(userId: bigint) {
    return this.prisma.subscriptions.findFirst({
      where: { user_id: userId },
      orderBy: { start_date: 'desc' },
      include: subInclude,
    });
  }

  private async jurisdictionFor(userId: bigint): Promise<Jurisdiction | null> {
    const u = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { country: true },
    });
    return jurisdictionOf(u?.country);
  }

  /** An active plan the user's jurisdiction may buy, or a reason why not. */
  private async availablePlan(
    planId: number | undefined,
    userId: bigint,
  ): Promise<plans | string> {
    if (planId == null) return 'planId is required.';
    const jurisdiction = await this.jurisdictionFor(userId);
    if (!jurisdiction) return 'Choose your billing country first.';
    const plan = await this.prisma.plans.findUnique({
      where: { id: BigInt(planId) },
    });
    if (!plan || !plan.is_active) return 'Plan not found.';
    if (plan.jurisdiction !== (jurisdiction as string))
      return "This plan isn't available in your region.";
    return plan;
  }

  /** Once a gateway has charged the user, their billing country is fixed. */
  async hasPaid(userId: bigint): Promise<boolean> {
    const paid = await this.prisma.subscriptions.findFirst({
      where: { user_id: userId, payment_gateway: { not: null } },
      select: { id: true },
    });
    return !!paid;
  }

  /**
   * GET /subscription/billing-profile — what the subscription screen needs:
   * where the user is billed, in what currency and by which gateway, whether
   * the one-time trial is still available, and whether the country can change.
   */
  async getBillingProfile(user: AuthUser): Promise<ResponseObject> {
    const u = await this.prisma.users.findUnique({
      where: { id: user.id },
      select: { country: true },
    });
    const jurisdiction = jurisdictionOf(u?.country);
    const [usedTrial, paid] = await Promise.all([
      this.prisma.subscriptions.findFirst({
        where: { user_id: user.id, trial_end_date: { not: null } },
        select: { id: true },
      }),
      this.hasPaid(user.id),
    ]);
    return ok('Billing profile retrieved.', {
      country: u?.country ?? null,
      jurisdiction,
      currency: jurisdiction ? BILLING[jurisdiction].currency : null,
      gateway: jurisdiction ? BILLING[jurisdiction].gateway : null,
      trialAvailable: !usedTrial,
      trialDays: TRIAL_DAYS,
      canChangeCountry: !paid,
    });
  }

  /** GET /subscription/payments — the caller's subscription charges, newest first. */
  async getPayments(user: AuthUser): Promise<ResponseObject> {
    const subs = await this.prisma.subscriptions.findMany({
      where: { user_id: user.id },
      select: {
        id: true,
        plans: { select: { display_name: true, name: true } },
      },
    });
    const planBySub = new Map(
      subs.map((s) => [s.id.toString(), s.plans.display_name ?? s.plans.name]),
    );
    const rows = subs.length
      ? await this.prisma.payments.findMany({
          where: { subscription_id: { in: subs.map((s) => s.id) } },
          orderBy: { paid_at: 'desc' },
        })
      : [];
    return ok(
      'Payments retrieved.',
      rows.map((p) => ({
        id: p.id,
        paidAt: p.paid_at,
        amount: p.amount != null ? Number(p.amount) : null,
        currency: p.currency,
        gateway: p.method,
        status: p.status,
        reference: p.transaction_ref,
        plan: planBySub.get(String(p.subscription_id)) ?? null,
      })),
    );
  }

  /** GET /subscription/plans — the active plans of the user's jurisdiction. */
  async getPlans(user: AuthUser): Promise<ResponseObject> {
    const jurisdiction = await this.jurisdictionFor(user.id);
    if (!jurisdiction)
      return ok('Choose your billing country to see plans.', []);
    const rows = await this.prisma.plans.findMany({
      where: { is_active: true, jurisdiction },
      orderBy: [{ price_monthly: 'asc' }, { id: 'asc' }],
    });
    return ok('Plans retrieved successfully.', rows.map(mapPlan));
  }

  /** GET /subscription/current — the caller's latest subscription (or null). */
  async getCurrent(user: AuthUser): Promise<ResponseObject> {
    const sub = await this.currentSubscription(user.id);
    return ok(
      'Current subscription retrieved.',
      sub ? mapSubscription(sub) : null,
    );
  }

  /**
   * POST /subscription/subscribe — the Free plan activates at once; a paid plan
   * starts the one-time 14-day trial. Paying always goes through checkout.
   */
  async subscribe(dto: SubscribeDto, user: AuthUser): Promise<ResponseObject> {
    const plan = await this.availablePlan(dto.planId, user.id);
    if (typeof plan === 'string') return fail(plan);
    const current = await this.currentSubscription(user.id);
    if (current && isPaidAndCurrent(current)) {
      return fail(
        'You already have a paid subscription — switching plans goes through checkout.',
        {
          requiresCheckout: true,
        },
      );
    }

    const now = new Date();
    if (isFreePlan(plan)) {
      const sub = await this.replaceWith(user.id, {
        plan_id: plan.id,
        status: 'ACTIVE',
        end_date: new Date(
          now.getFullYear() + FREE_PLAN_YEARS,
          now.getMonth(),
          now.getDate(),
        ),
      });
      return ok('You are on the free plan.', mapSubscription(sub));
    }

    const usedTrial = await this.prisma.subscriptions.findFirst({
      where: { user_id: user.id, trial_end_date: { not: null } },
      select: { id: true },
    });
    if (usedTrial) {
      return fail(
        'Your free trial has already been used — continue to checkout to subscribe.',
        {
          requiresCheckout: true,
        },
      );
    }
    const trialEnd = daysFrom(now, TRIAL_DAYS);
    const sub = await this.replaceWith(user.id, {
      plan_id: plan.id,
      status: 'TRIAL',
      trial_end_date: trialEnd,
      end_date: trialEnd,
    });
    return ok('Your 14-day free trial has started.', mapSubscription(sub));
  }

  /** Retire the user's active subscription (trial/free) and start a new one. */
  private async replaceWith(
    userId: bigint,
    data: Pick<
      Prisma.subscriptionsUncheckedCreateInput,
      'plan_id' | 'status' | 'end_date' | 'trial_end_date'
    >,
  ) {
    await this.prisma.subscriptions.updateMany({
      where: { user_id: userId, is_active: true, payment_gateway: null },
      data: { is_active: false, status: 'REPLACED' },
    });
    return this.prisma.subscriptions.create({
      data: {
        ...data,
        user_id: userId,
        start_date: new Date(),
        is_active: true,
        is_cancelled: false,
        auto_renew: false,
      },
      include: subInclude,
    });
  }

  /**
   * POST /subscription/change — a trial switches plan in place; a paid plan is
   * switched through checkout (the old one stops when the new one is paid).
   */
  async changePlan(
    dto: ChangePlanDto,
    user: AuthUser,
  ): Promise<ResponseObject> {
    const plan = await this.availablePlan(dto.planId, user.id);
    if (typeof plan === 'string') return fail(plan);
    const current = await this.currentSubscription(user.id);
    if (!current || !current.is_active) return this.subscribe(dto, user);
    if (isPaidAndCurrent(current)) {
      return fail('Switching a paid plan goes through checkout.', {
        requiresCheckout: true,
      });
    }
    if (current.status === 'TRIAL' && !isFreePlan(plan)) {
      const updated = await this.prisma.subscriptions.update({
        where: { id: current.id },
        data: { plan_id: plan.id },
        include: subInclude,
      });
      return ok('Subscription plan updated.', mapSubscription(updated));
    }
    return this.subscribe(dto, user);
  }

  /**
   * POST /subscription/cancel — a paid plan stops renewing and stays usable
   * until the end of the period already paid for; a trial ends now.
   */
  async cancel(user: AuthUser): Promise<ResponseObject> {
    const current = await this.currentSubscription(user.id);
    if (!current || !current.is_active)
      return fail('No active subscription to cancel.');

    if (isPaidAndCurrent(current)) {
      try {
        await this.billing.cancelAtGateway(current, true);
      } catch (e) {
        this.logger.error(
          `Gateway cancel failed for ${current.id}: ${(e as Error).message}`,
        );
        return fail(
          "We couldn't cancel with the payment provider. Please try again.",
        );
      }
      const updated = await this.prisma.subscriptions.update({
        where: { id: current.id },
        data: { is_cancelled: true, auto_renew: false, status: 'CANCELLED' },
        include: subInclude,
      });
      return ok(
        `Subscription cancelled. You keep access until ${updated.end_date.toDateString()}.`,
        mapSubscription(updated),
      );
    }

    const updated = await this.prisma.subscriptions.update({
      where: { id: current.id },
      data: { is_cancelled: true, status: 'CANCELLED', is_active: false },
      include: subInclude,
    });
    return ok('Subscription cancelled.', mapSubscription(updated));
  }

  /**
   * PUT /subscription/country — set the billing country. It can change freely
   * until the first payment; after that only platform admins can change it.
   * A running trial moves to the same tier in the new jurisdiction.
   */
  async setCountry(dto: CountryDto, user: AuthUser): Promise<ResponseObject> {
    const country = normalizeCountry(dto.country);
    if (!country) return fail('Choose a valid country.');
    if (await this.hasPaid(user.id)) {
      return fail(
        'Your billing country is fixed once you have paid for a plan. Contact support to change it.',
      );
    }
    await this.prisma.users.update({
      where: { id: user.id },
      data: { country },
    });
    const jurisdiction = jurisdictionOf(country)!;

    const current = await this.currentSubscription(user.id);
    if (
      current?.is_active &&
      current.status === 'TRIAL' &&
      current.plans?.jurisdiction !== (jurisdiction as string)
    ) {
      const equivalent = current.plans?.tier
        ? await this.prisma.plans.findFirst({
            where: { tier: current.plans.tier, jurisdiction, is_active: true },
          })
        : null;
      if (equivalent) {
        await this.prisma.subscriptions.update({
          where: { id: current.id },
          data: { plan_id: equivalent.id },
        });
      }
    }
    return ok('Billing country saved.', {
      country,
      jurisdiction,
      currency: BILLING[jurisdiction].currency,
    });
  }

  /**
   * Daily: end trials that ran out, and paid periods that weren't renewed
   * within the grace window (gateways retry failed charges meanwhile).
   */
  @Cron('0 30 2 * * *')
  async expireLapsed(): Promise<void> {
    const now = new Date();
    const trials = await this.prisma.subscriptions.updateMany({
      where: { is_active: true, status: 'TRIAL', end_date: { lt: now } },
      data: { is_active: false, status: 'EXPIRED' },
    });
    const paid = await this.prisma.subscriptions.updateMany({
      where: {
        is_active: true,
        payment_gateway: { not: null },
        end_date: { lt: daysFrom(now, -GRACE_DAYS) },
      },
      data: { is_active: false, status: 'EXPIRED' },
    });
    if (trials.count || paid.count) {
      this.logger.log(
        `Expired ${trials.count} trial(s) and ${paid.count} lapsed paid subscription(s).`,
      );
    }
  }

  /**
   * Quota gate for invoice creation: compares the user's current plan
   * `max_invoices_per_month` against this calendar month's invoice count for the
   * given business. A null limit means unlimited. Provided for callers to wire
   * in (not enforced globally).
   */
  async checkInvoiceQuota(
    userId: bigint,
    businessId: bigint,
  ): Promise<{ allowed: boolean; message?: string }> {
    const sub = await this.currentSubscription(userId);
    if (!sub || !sub.plans) {
      return {
        allowed: false,
        message:
          'No active subscription plan found. Please subscribe to a plan.',
      };
    }

    const limit = sub.plans.max_invoices_per_month;
    if (limit == null) return { allowed: true }; // unlimited

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const used = await this.prisma.invoices.count({
      where: {
        business_id: businessId,
        invoice_date: { gte: startOfMonth, lt: startOfNextMonth },
      },
    });

    if (used >= limit) {
      return {
        allowed: false,
        message: `Monthly invoice limit reached (${used}/${limit}). Upgrade your plan to create more.`,
      };
    }
    return { allowed: true };
  }
}
