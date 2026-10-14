import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionBillingService } from './subscription-billing.service';
import { SubscriptionService } from './subscription.service';

const makeService = (prisma: object) =>
  new SubscriptionService(
    prisma as unknown as PrismaService,
    {} as unknown as SubscriptionBillingService,
  );

describe('SubscriptionService.expireLapsed', () => {
  it('ends run-out trials, and paid periods only after the grace window', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    await makeService({ subscriptions: { updateMany } }).expireLapsed();

    const [trials, paid] = updateMany.mock.calls.map(
      (c: [{ where: Record<string, unknown> }]) => c[0].where,
    );
    expect(trials).toMatchObject({ is_active: true, status: 'TRIAL' });
    expect(paid).toMatchObject({
      is_active: true,
      payment_gateway: { not: null },
    });

    // Paid access survives 3 days past end_date while the gateway retries.
    const cutoff = (paid.end_date as { lt: Date }).lt.getTime();
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff - threeDaysAgo)).toBeLessThan(5000);
  });
});

describe('SubscriptionService.onModuleInit (seeding)', () => {
  it('never touches plans once any exist (admins own them)', async () => {
    const create = jest.fn();
    await makeService({
      plans: { count: jest.fn().mockResolvedValue(3), create },
    }).onModuleInit();
    expect(create).not.toHaveBeenCalled();
  });

  it('seeds each tier for both jurisdictions into an empty table', async () => {
    const create = jest.fn().mockResolvedValue({});
    await makeService({
      plans: { count: jest.fn().mockResolvedValue(0), create },
    }).onModuleInit();
    const rows = create.mock.calls.map(
      (
        c: [{ data: { jurisdiction: string; currency: string; name: string } }],
      ) => c[0].data,
    );
    expect(rows).toHaveLength(8);
    expect(
      rows
        .filter((r) => r.jurisdiction === 'NG')
        .every((r) => r.currency === 'NGN'),
    ).toBe(true);
    expect(
      rows
        .filter((r) => r.jurisdiction === 'OTHER')
        .every((r) => r.currency === 'USD'),
    ).toBe(true);
    expect(new Set(rows.map((r) => r.name)).size).toBe(8); // plan names are unique
  });
});
