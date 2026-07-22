import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, plans } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { SubscribeDto, ChangePlanDto } from './dto/subscription.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 14;
const DEFAULT_DURATION_DAYS = 30;

/** Float columns come back as `number`; normalise (and null-guard) for output. */
const num = (v: number | null): number | null => (v == null ? null : Number(v));

const subInclude = { plans: true } satisfies Prisma.subscriptionsInclude;
type SubscriptionWithPlan = Prisma.subscriptionsGetPayload<{ include: typeof subInclude }>;

@Injectable()
export class SubscriptionService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Seed / refresh the four subscription tiers on startup. Idempotent: upserts
   * by the unique `name` so existing rows (and any manual price edits done via
   * update) are re-synced without ever deleting subscriptions' referenced plans.
   */
  async onModuleInit(): Promise<void> {
    // Identical key set on every tier so the array infers one uniform element
    // type (assignable to both plansCreateInput and plansUpdateInput).
    const tiers = [
      {
        name: 'Free',
        display_name: 'Free',
        description: 'Get started with the essentials at no cost.',
        duration_in_days: DEFAULT_DURATION_DAYS,
        price: 0,
        price_ngn_monthly: 0,
        price_ngn_yearly: 0,
        price_usd_monthly: 0,
        price_usd_yearly: 0,
        max_invoices_per_month: 5 as number | null,
        max_businesses: 1 as number | null,
        max_team_members: 1 as number | null,
        allow_payment_collection: false,
        allow_recurring_invoices: false,
        allow_custom_templates: false,
        allow_api_access: false,
        is_active: true,
      },
      {
        name: 'Basic',
        display_name: 'Basic',
        description: 'For freelancers and small teams getting off the ground.',
        duration_in_days: DEFAULT_DURATION_DAYS,
        price: 5000,
        price_ngn_monthly: 5000,
        price_ngn_yearly: 50000,
        price_usd_monthly: 10,
        price_usd_yearly: 100,
        max_invoices_per_month: 50 as number | null,
        max_businesses: 2 as number | null,
        max_team_members: 3 as number | null,
        allow_payment_collection: true,
        allow_recurring_invoices: true,
        allow_custom_templates: false,
        allow_api_access: false,
        is_active: true,
      },
      {
        name: 'Professional',
        display_name: 'Professional',
        description: 'For growing businesses that need more power and customization.',
        duration_in_days: DEFAULT_DURATION_DAYS,
        price: 15000,
        price_ngn_monthly: 15000,
        price_ngn_yearly: 150000,
        price_usd_monthly: 30,
        price_usd_yearly: 300,
        max_invoices_per_month: 500 as number | null,
        max_businesses: 5 as number | null,
        max_team_members: 10 as number | null,
        allow_payment_collection: true,
        allow_recurring_invoices: true,
        allow_custom_templates: true,
        allow_api_access: false,
        is_active: true,
      },
      {
        name: 'Enterprise',
        display_name: 'Enterprise',
        description: 'Unlimited scale with every feature and priority support.',
        duration_in_days: DEFAULT_DURATION_DAYS,
        price: 50000,
        price_ngn_monthly: 50000,
        price_ngn_yearly: 500000,
        price_usd_monthly: 100,
        price_usd_yearly: 1000,
        // null == unlimited
        max_invoices_per_month: null as number | null,
        max_businesses: null as number | null,
        max_team_members: null as number | null,
        allow_payment_collection: true,
        allow_recurring_invoices: true,
        allow_custom_templates: true,
        allow_api_access: true,
        is_active: true,
      },
    ];

    for (const tier of tiers) {
      await this.prisma.plans.upsert({ where: { name: tier.name }, create: tier, update: tier });
    }
    this.logger.log(`Synced ${tiers.length} subscription plan tiers.`);
  }

  private mapPlan(p: plans) {
    return {
      id: p.id,
      name: p.name,
      displayName: p.display_name,
      description: p.description,
      priceNgnMonthly: num(p.price_ngn_monthly),
      priceNgnYearly: num(p.price_ngn_yearly),
      priceUsdMonthly: num(p.price_usd_monthly),
      priceUsdYearly: num(p.price_usd_yearly),
      maxInvoicesPerMonth: p.max_invoices_per_month,
      maxBusinesses: p.max_businesses,
      maxTeamMembers: p.max_team_members,
      allowPaymentCollection: p.allow_payment_collection,
      allowRecurringInvoices: p.allow_recurring_invoices,
      allowCustomTemplates: p.allow_custom_templates,
      allowApiAccess: p.allow_api_access,
    };
  }

  private mapSubscription(s: SubscriptionWithPlan) {
    return {
      id: s.id,
      status: s.status,
      startDate: s.start_date,
      endDate: s.end_date,
      trialEndDate: s.trial_end_date,
      isActive: s.is_active,
      isCancelled: s.is_cancelled,
      autoRenew: s.auto_renew,
      lastPaymentDate: s.last_payment_date,
      nextPaymentDate: s.next_payment_date,
      planId: s.plan_id,
      plan: s.plans ? this.mapPlan(s.plans) : null,
    };
  }

  /** The current user's most-recent subscription, most recent first. */
  private currentSubscription(userId: bigint) {
    return this.prisma.subscriptions.findFirst({
      where: { user_id: userId },
      orderBy: { start_date: 'desc' },
      include: subInclude,
    });
  }

  /** GET /subscription/plans — active plans in the public catalogue shape. */
  async getPlans(): Promise<ResponseObject> {
    const rows = await this.prisma.plans.findMany({ where: { is_active: true }, orderBy: { id: 'asc' } });
    return ok('Plans retrieved successfully.', rows.map((p) => this.mapPlan(p)));
  }

  /** GET /subscription/current — the caller's latest subscription (or null). */
  async getCurrent(user: AuthUser): Promise<ResponseObject> {
    const sub = await this.currentSubscription(user.id);
    return ok('Current subscription retrieved.', sub ? this.mapSubscription(sub) : null);
  }

  /** POST /subscription/subscribe — start a 14-day trial on the chosen plan. */
  async subscribe(dto: SubscribeDto, user: AuthUser): Promise<ResponseObject> {
    if (dto.planId == null) return fail('planId is required.');
    const plan = await this.prisma.plans.findUnique({ where: { id: BigInt(dto.planId) } });
    if (!plan) return fail('Plan not found.');

    const now = new Date();
    const durationDays = plan.duration_in_days ?? DEFAULT_DURATION_DAYS;
    const sub = await this.prisma.subscriptions.create({
      data: {
        user_id: user.id,
        plan_id: plan.id,
        status: 'TRIAL',
        trial_end_date: new Date(now.getTime() + TRIAL_DAYS * DAY_MS),
        start_date: now,
        end_date: new Date(now.getTime() + durationDays * DAY_MS),
        is_active: true,
        is_cancelled: false,
        auto_renew: true,
      },
      include: subInclude,
    });
    return ok('Subscription created. Your trial has started.', this.mapSubscription(sub));
  }

  /** POST /subscription/change — upgrade / downgrade the current subscription. */
  async changePlan(dto: ChangePlanDto, user: AuthUser): Promise<ResponseObject> {
    if (dto.planId == null) return fail('planId is required.');
    const plan = await this.prisma.plans.findUnique({ where: { id: BigInt(dto.planId) } });
    if (!plan) return fail('Plan not found.');

    const current = await this.currentSubscription(user.id);
    if (!current) return fail('No active subscription to change. Subscribe to a plan first.');

    const updated = await this.prisma.subscriptions.update({
      where: { id: current.id },
      data: { plan_id: plan.id },
      include: subInclude,
    });
    return ok('Subscription plan updated.', this.mapSubscription(updated));
  }

  /** POST /subscription/cancel — cancel the current subscription. */
  async cancel(user: AuthUser): Promise<ResponseObject> {
    const current = await this.currentSubscription(user.id);
    if (!current) return fail('No active subscription to cancel.');

    const updated = await this.prisma.subscriptions.update({
      where: { id: current.id },
      data: { is_cancelled: true, status: 'CANCELLED', is_active: false },
      include: subInclude,
    });
    return ok('Subscription cancelled.', this.mapSubscription(updated));
  }

  /**
   * Quota gate for invoice creation: compares the user's current plan
   * `max_invoices_per_month` against this calendar month's invoice count for the
   * given business. A null limit means unlimited. Provided for callers to wire
   * in (not enforced globally).
   */
  async checkInvoiceQuota(userId: bigint, businessId: bigint): Promise<{ allowed: boolean; message?: string }> {
    const sub = await this.currentSubscription(userId);
    if (!sub || !sub.plans) {
      return { allowed: false, message: 'No active subscription plan found. Please subscribe to a plan.' };
    }

    const limit = sub.plans.max_invoices_per_month;
    if (limit == null) return { allowed: true }; // unlimited

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const used = await this.prisma.invoices.count({
      where: { business_id: businessId, invoice_date: { gte: startOfMonth, lt: startOfNextMonth } },
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
