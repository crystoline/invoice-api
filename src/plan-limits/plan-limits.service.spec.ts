import { PrismaService } from '../prisma/prisma.service';
import { PlanLimitsService } from './plan-limits.service';

const OWNER = 10n;
const MEMBER = 11n;
const DAY = 24 * 60 * 60 * 1000;

const plan = (over: Record<string, unknown>) => ({
  jurisdiction: 'NG',
  price_monthly: 0,
  price_yearly: 0,
  max_invoices_per_month: 5,
  max_businesses: 1,
  max_team_members: 1,
  allow_recurring_invoices: false,
  allow_payment_collection: false,
  ...over,
});
const NG_FREE = plan({ id: 1n, name: 'Free' });
const US_FREE = plan({ id: 2n, name: 'Free (USD)', jurisdiction: 'OTHER' });
const PRO = plan({
  id: 3n,
  name: 'Professional',
  price_monthly: 15000,
  max_invoices_per_month: null,
  max_businesses: 5,
  max_team_members: 3,
  allow_recurring_invoices: true,
  allow_payment_collection: true,
});

const sub = (over: Record<string, unknown> = {}) => ({
  is_active: true,
  status: 'ACTIVE',
  payment_gateway: 'PAYSTACK',
  end_date: new Date(Date.now() + 10 * DAY),
  plans: PRO,
  ...over,
});

const makeLimits = (o: {
  sub?: object | null;
  country?: string | null;
  freePlans?: object[];
  owned?: number;
  members?: number;
  pending?: number;
  invoices?: number;
}) =>
  new PlanLimitsService({
    subscriptions: { findFirst: jest.fn().mockResolvedValue(o.sub ?? null) },
    users: {
      findUnique: jest.fn().mockResolvedValue({
        country: o.country === undefined ? 'NG' : o.country,
      }),
    },
    plans: {
      findMany: jest.fn().mockResolvedValue(o.freePlans ?? [NG_FREE, US_FREE]),
    },
    businesses: {
      findUnique: jest.fn().mockResolvedValue({ owner_id: OWNER }),
      count: jest.fn().mockResolvedValue(o.owned ?? 0),
    },
    business_members: { count: jest.fn().mockResolvedValue(o.members ?? 0) },
    business_invitations: {
      count: jest.fn().mockResolvedValue(o.pending ?? 0),
    },
    invoices: { count: jest.fn().mockResolvedValue(o.invoices ?? 0) },
  } as unknown as PrismaService);

describe('PlanLimitsService.planFor', () => {
  it('uses the live subscription, a trial included', async () => {
    expect(await makeLimits({ sub: sub() }).planFor(OWNER)).toBe(PRO);
    const trial = sub({ status: 'TRIAL', payment_gateway: null });
    expect(await makeLimits({ sub: trial }).planFor(OWNER)).toBe(PRO);
  });

  it('keeps a paid plan through the grace window after a missed renewal', async () => {
    const lapsed = sub({ end_date: new Date(Date.now() - 2 * DAY) });
    expect(await makeLimits({ sub: lapsed }).planFor(OWNER)).toBe(PRO);
  });

  it('falls back to the Free plan of the billing jurisdiction', async () => {
    const ranOut = sub({
      status: 'TRIAL',
      payment_gateway: null,
      end_date: new Date(Date.now() - DAY),
    });
    expect(await makeLimits({ sub: ranOut }).planFor(OWNER)).toBe(NG_FREE);
    expect(await makeLimits({ country: 'GB' }).planFor(OWNER)).toBe(US_FREE);
    expect(await makeLimits({ country: null }).planFor(OWNER)).toBe(NG_FREE);
  });

  it('is null only when there is no Free plan at all', async () => {
    expect(await makeLimits({ freePlans: [] }).planFor(OWNER)).toBeNull();
  });
});

describe('PlanLimitsService limits', () => {
  it('caps the businesses an account owns', async () => {
    expect(await makeLimits({ owned: 0 }).canCreateBusiness(OWNER)).toEqual({
      allowed: true,
    });
    expect(await makeLimits({ owned: 1 }).canCreateBusiness(OWNER)).toEqual({
      allowed: false,
      message:
        'Your plan allows 1 business. Upgrade your plan in Settings → Subscription.',
    });
    // Unlimited (null) on the subscription's plan.
    const ent = sub({ plans: { ...PRO, max_businesses: null } });
    expect(
      (await makeLimits({ sub: ent, owned: 40 }).canCreateBusiness(OWNER))
        .allowed,
    ).toBe(true);
  });

  it('counts the owner, members and open invitations as seats', async () => {
    const pro = sub();
    expect(
      (await makeLimits({ sub: pro, members: 1 }).canInvite(1n, OWNER)).allowed,
    ).toBe(true);
    const full = await makeLimits({
      sub: pro,
      members: 1,
      pending: 1,
    }).canInvite(1n, MEMBER);
    expect(full).toEqual({
      allowed: false,
      message:
        "This business's plan allows 3 people in a business, including the owner. There is 1 invitation still open. Ask the business owner to upgrade their plan.",
    });
    // Joining doesn't count the invitation being used.
    expect(
      (await makeLimits({ sub: pro, members: 1, pending: 1 }).canJoin(1n, 40n))
        .allowed,
    ).toBe(true);
  });

  it("limits a month's invoices across the owner's businesses", async () => {
    expect(
      (await makeLimits({ invoices: 4 }).canCreateInvoice(1n, OWNER)).allowed,
    ).toBe(true);
    expect(
      await makeLimits({ invoices: 5 }).canCreateInvoice(1n, MEMBER),
    ).toEqual({
      allowed: false,
      message:
        'Monthly invoice limit reached (5/5). Ask the business owner to upgrade their plan.',
    });
  });

  it('gates recurring invoices and online payments on the plan', async () => {
    expect(await makeLimits({}).canUseRecurring(1n, OWNER)).toEqual({
      allowed: false,
      message:
        'Recurring invoices are not included in your plan. Upgrade your plan in Settings → Subscription.',
    });
    expect((await makeLimits({}).canCollectPayments(1n)).allowed).toBe(false);
    const pro = sub();
    expect((await makeLimits({ sub: pro }).canUseRecurring(1n)).allowed).toBe(
      true,
    );
    expect(
      (await makeLimits({ sub: pro }).canCollectPayments(1n)).allowed,
    ).toBe(true);
  });

  it('asks for a plan when there is nothing to fall back on', async () => {
    expect(await makeLimits({ freePlans: [] }).canCreateInvoice(1n)).toEqual({
      allowed: false,
      message: 'Choose a plan in Settings → Subscription to continue.',
    });
  });
});
