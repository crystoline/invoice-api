import { Prisma, plans, subscriptions } from '@prisma/client';

export const subInclude = { plans: true } satisfies Prisma.subscriptionsInclude;
export type SubscriptionWithPlan = Prisma.subscriptionsGetPayload<{
  include: typeof subInclude;
}>;

/** Float columns come back as `number`; normalise (and null-guard) for output. */
const num = (v: number | null): number | null => (v == null ? null : Number(v));

export const isFreePlan = (p: plans): boolean =>
  !((p.price_monthly ?? 0) > 0) && !((p.price_yearly ?? 0) > 0);

/** Grace after a missed renewal before access ends (gateways retry meanwhile). */
export const GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a subscription still grants its plan: trials and free plans until
 * end_date, paid plans through the grace window after it.
 */
export const grantsAccess = (s: subscriptions, now = new Date()): boolean =>
  !!s.is_active &&
  s.end_date.getTime() + (s.payment_gateway ? GRACE_DAYS * DAY_MS : 0) >
    now.getTime();

/** A subscription a gateway is billing (or has billed) that still grants access. */
export const isPaidAndCurrent = (s: subscriptions, now = new Date()): boolean =>
  !!s.payment_gateway &&
  s.is_active &&
  ['ACTIVE', 'PAST_DUE', 'CANCELLED'].includes(s.status ?? '') &&
  s.end_date > now;

export const mapPlan = (p: plans) => ({
  id: p.id,
  name: p.name,
  displayName: p.display_name,
  description: p.description,
  jurisdiction: p.jurisdiction,
  currency: p.currency,
  priceMonthly: num(p.price_monthly),
  priceYearly: num(p.price_yearly),
  tier: p.tier,
  isFree: isFreePlan(p),
  maxInvoicesPerMonth: p.max_invoices_per_month,
  maxBusinesses: p.max_businesses,
  maxTeamMembers: p.max_team_members,
  allowPaymentCollection: p.allow_payment_collection,
  allowRecurringInvoices: p.allow_recurring_invoices,
  allowCustomTemplates: p.allow_custom_templates,
  allowApiAccess: p.allow_api_access,
});

export const mapSubscription = (s: SubscriptionWithPlan) => ({
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
  billingInterval: s.billing_interval,
  paymentGateway: s.payment_gateway,
  isPaid: !!s.payment_gateway,
  planId: s.plan_id,
  plan: s.plans ? mapPlan(s.plans) : null,
});
