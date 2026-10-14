import { Injectable } from '@nestjs/common';
import { plans } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { jurisdictionOf } from '../subscription/jurisdiction';
import { grantsAccess, mapPlan } from '../subscription/subscription.mapper';

/** Allowed, or refused with the message to show the user. */
export type LimitCheck =
  { allowed: true } | { allowed: false; message: string };

const ALLOWED: LimitCheck = { allowed: true };
const refuse = (message: string): LimitCheck => ({ allowed: false, message });

const NO_PLAN = 'Choose a plan in Settings → Subscription to continue.';

/** A plan limit as a number, or null when unlimited (null or negative). */
const limitOf = (v: number | null): number | null =>
  v == null || v < 0 ? null : v;

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Messages speak to whoever hit the limit: the owner can upgrade, anyone else
 * has to ask them. No actor (a scheduled job) reads as the owner.
 */
const isOwner = (ownerId: bigint, actorId?: bigint) =>
  actorId === undefined || actorId === ownerId;

const upgradeHint = (owner: boolean) =>
  owner
    ? 'Upgrade your plan in Settings → Subscription.'
    : 'Ask the business owner to upgrade their plan.';

/**
 * Plan limits. A business runs on its owner's plan: the owner's live
 * subscription (a trial counts), or the Free plan of the owner's billing
 * jurisdiction when they have none. A null limit means unlimited.
 */
@Injectable()
export class PlanLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The plan whose limits apply to an account; null only if no Free plan exists. */
  async planFor(userId: bigint): Promise<plans | null> {
    const sub = await this.prisma.subscriptions.findFirst({
      where: { user_id: userId, is_active: true },
      orderBy: { start_date: 'desc' },
      include: { plans: true },
    });
    if (sub && grantsAccess(sub)) return sub.plans;

    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { country: true },
    });
    const free = await this.prisma.plans.findMany({
      where: {
        is_active: true,
        AND: [
          { OR: [{ price_monthly: null }, { price_monthly: { lte: 0 } }] },
          { OR: [{ price_yearly: null }, { price_yearly: { lte: 0 } }] },
        ],
      },
      orderBy: { id: 'asc' },
    });
    const jurisdiction = jurisdictionOf(user?.country);
    return (
      free.find(
        (p) => !!jurisdiction && p.jurisdiction === (jurisdiction as string),
      ) ??
      free[0] ??
      null
    );
  }

  private async businessPlan(businessId: bigint) {
    const biz = await this.prisma.businesses.findUnique({
      where: { id: businessId },
      select: { owner_id: true },
    });
    if (!biz?.owner_id) return null;
    return { ownerId: biz.owner_id, plan: await this.planFor(biz.owner_id) };
  }

  private invoicesThisMonth(ownerId: bigint, now = new Date()) {
    return this.prisma.invoices.count({
      where: {
        businesses: { owner_id: ownerId },
        invoice_date: {
          gte: new Date(now.getFullYear(), now.getMonth(), 1),
          lt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
        },
      },
    });
  }

  /** An account owns at most `max_businesses` businesses. */
  async canCreateBusiness(userId: bigint): Promise<LimitCheck> {
    const plan = await this.planFor(userId);
    if (!plan) return refuse(NO_PLAN);
    const limit = limitOf(plan.max_businesses);
    if (limit === null) return ALLOWED;
    const owned = await this.prisma.businesses.count({
      where: { owner_id: userId },
    });
    if (owned < limit) return ALLOWED;
    return refuse(
      `Your plan allows ${plural(limit, 'business', 'businesses')}. ${upgradeHint(true)}`,
    );
  }

  /**
   * Room to invite one more person. A business's seats are its owner, its
   * members and the invitations still open; `max_team_members` caps them.
   */
  canInvite(businessId: bigint, actorId: bigint): Promise<LimitCheck> {
    return this.seats(businessId, actorId, true);
  }

  /** Checked again on joining, in case the plan changed since the invitation. */
  canJoin(businessId: bigint, userId: bigint): Promise<LimitCheck> {
    return this.seats(businessId, userId, false);
  }

  private async seats(
    businessId: bigint,
    actorId: bigint,
    countInvitations: boolean,
  ): Promise<LimitCheck> {
    const bp = await this.businessPlan(businessId);
    if (!bp?.plan) return refuse(NO_PLAN);
    const limit = limitOf(bp.plan.max_team_members);
    if (limit === null) return ALLOWED;
    const members = await this.prisma.business_members.count({
      where: { business_id: businessId },
    });
    const pending = countInvitations
      ? await this.prisma.business_invitations.count({
          where: {
            business_id: businessId,
            accepted_at: null,
            expires_at: { gt: new Date() },
          },
        })
      : 0;
    if (1 + members + pending < limit) return ALLOWED;
    const owner = isOwner(bp.ownerId, actorId);
    const open = pending
      ? ` There ${pending === 1 ? 'is' : 'are'} ${plural(pending, 'invitation', 'invitations')} still open.`
      : '';
    return refuse(
      `${owner ? 'Your' : "This business's"} plan allows ${plural(limit, 'person', 'people')} in a business, including the owner.${open} ${upgradeHint(owner)}`,
    );
  }

  /** `max_invoices_per_month` across all the businesses the owner has. */
  async canCreateInvoice(
    businessId: bigint,
    actorId?: bigint,
  ): Promise<LimitCheck> {
    const bp = await this.businessPlan(businessId);
    if (!bp?.plan) return refuse(NO_PLAN);
    const limit = limitOf(bp.plan.max_invoices_per_month);
    if (limit === null) return ALLOWED;
    const used = await this.invoicesThisMonth(bp.ownerId);
    if (used < limit) return ALLOWED;
    return refuse(
      `Monthly invoice limit reached (${used}/${limit}). ${upgradeHint(isOwner(bp.ownerId, actorId))}`,
    );
  }

  canUseRecurring(businessId: bigint, actorId?: bigint): Promise<LimitCheck> {
    return this.feature(
      businessId,
      actorId,
      'allow_recurring_invoices',
      'Recurring invoices are',
    );
  }

  canCollectPayments(
    businessId: bigint,
    actorId?: bigint,
  ): Promise<LimitCheck> {
    return this.feature(
      businessId,
      actorId,
      'allow_payment_collection',
      'Online payments are',
    );
  }

  private async feature(
    businessId: bigint,
    actorId: bigint | undefined,
    flag: 'allow_recurring_invoices' | 'allow_payment_collection',
    subject: string,
  ): Promise<LimitCheck> {
    const bp = await this.businessPlan(businessId);
    if (!bp?.plan) return refuse(NO_PLAN);
    if (bp.plan[flag]) return ALLOWED;
    const owner = isOwner(bp.ownerId, actorId);
    return refuse(
      `${subject} not included in ${owner ? 'your plan' : "this business's plan"}. ${upgradeHint(owner)}`,
    );
  }

  /** The account's plan and how much of it the businesses they own use. */
  async usage(userId: bigint) {
    const [plan, invoicesThisMonth, businesses] = await Promise.all([
      this.planFor(userId),
      this.invoicesThisMonth(userId),
      this.prisma.businesses.count({ where: { owner_id: userId } }),
    ]);
    return {
      plan: plan ? mapPlan(plan) : null,
      invoicesThisMonth,
      businesses,
    };
  }
}
