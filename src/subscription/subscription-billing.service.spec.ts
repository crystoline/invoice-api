import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackService } from '../payment/paystack.service';
import { StripeService } from '../payment/stripe.service';
import { SubscriptionBillingService } from './subscription-billing.service';
import { addInterval } from './jurisdiction';

const DAY = 24 * 60 * 60 * 1000;
const NG_USER = { id: 10n, country: 'NG', email: 'owner@test' };
const US_USER = { id: 20n, country: 'US', email: 'other@test' };
const NG_BASIC = {
  id: 2n,
  name: 'Basic',
  display_name: 'Basic',
  is_active: true,
  jurisdiction: 'NG',
  price_monthly: 5000,
  price_yearly: 50000,
};
const US_BASIC = {
  ...NG_BASIC,
  id: 6n,
  jurisdiction: 'OTHER',
  price_monthly: 10,
};
const trialEnding = (inMs: number) => ({
  id: 1n,
  status: 'TRIAL',
  is_active: true,
  payment_gateway: null,
  last_payment_date: null,
  end_date: new Date(Date.now() + inMs),
});

const setup = (o: {
  user?: object;
  plan?: object;
  current?: object | null;
}) => {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    users: { findUnique: jest.fn().mockResolvedValue(o.user ?? NG_USER) },
    plans: { findUnique: jest.fn().mockResolvedValue(o.plan ?? NG_BASIC) },
    gateway_plans: {
      findFirst: jest.fn().mockResolvedValue({ gateway_plan_code: 'PLN_1' }),
    },
    subscriptions: {
      findFirst: jest.fn().mockResolvedValue(o.current ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve({ id: 99n, ...data });
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    payments: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const initializeCardPayment = jest.fn().mockResolvedValue('https://ps');
  const createSubscription = jest
    .fn()
    .mockResolvedValue({ subscription_code: 'SUB_1', email_token: 'tok' });
  const createSubscriptionCheckout = jest.fn().mockResolvedValue('https://st');
  const service = new SubscriptionBillingService(
    prisma as unknown as PrismaService,
    { get: () => 'https://app.test' } as unknown as ConfigService,
    {
      configured: true,
      initializeCardPayment,
      createSubscription,
    } as unknown as PaystackService,
    {
      configured: true,
      createSubscriptionCheckout,
    } as unknown as StripeService,
  );
  return {
    service,
    prisma,
    created,
    initializeCardPayment,
    createSubscription,
    createSubscriptionCheckout,
  };
};

const lastArg = (fn: jest.Mock) =>
  (fn.mock.calls.at(-1) as [Record<string, unknown>])[0];

describe('checkout during a trial keeps the days left', () => {
  it('Paystack: charges now for the period that starts when the trial ends', async () => {
    const trial = trialEnding(10 * DAY);
    const t = setup({ current: trial });
    const res = await t.service.checkout({ planId: 2, interval: 'monthly' }, {
      id: 10n,
    } as never);
    expect(res.responseCode).toBe('00');
    expect(lastArg(t.initializeCardPayment).metadata).toMatchObject({
      kind: 'subscription',
      planCode: 'PLN_1',
      startAt: trial.end_date.toISOString(),
    });
  });

  it('Stripe: saves the card and first charges when the trial ends', async () => {
    const trial = trialEnding(10 * DAY);
    const t = setup({ user: US_USER, plan: US_BASIC, current: trial });
    await t.service.checkout({ planId: 6, interval: 'monthly' }, {
      id: 20n,
    } as never);
    expect(lastArg(t.createSubscriptionCheckout).trialEnd).toEqual(
      trial.end_date,
    );
  });

  it('Stripe: a trial ending within 48 hours is stretched to its minimum', async () => {
    const t = setup({
      user: US_USER,
      plan: US_BASIC,
      current: trialEnding(DAY),
    });
    await t.service.checkout({ planId: 6, interval: 'monthly' }, {
      id: 20n,
    } as never);
    const trialEnd = lastArg(t.createSubscriptionCheckout).trialEnd as Date;
    expect(trialEnd.getTime()).toBeGreaterThan(
      Date.now() + 48 * 60 * 60 * 1000,
    );
  });

  it('without a trial, the paid period starts now', async () => {
    const t = setup({ user: US_USER, plan: US_BASIC, current: null });
    await t.service.checkout({ planId: 6, interval: 'monthly' }, {
      id: 20n,
    } as never);
    const args = lastArg(t.createSubscriptionCheckout);
    expect(args.trialEnd).toBeUndefined();
    expect(args.metadata).not.toHaveProperty('startAt');
  });
});

describe('activation from the gateway', () => {
  const startAt = new Date(Date.now() + 10 * DAY);
  const paystackCharge = (reusable: boolean) => ({
    event: 'charge.success',
    data: {
      reference: 'ref_1',
      amount: 500000,
      currency: 'NGN',
      metadata: {
        kind: 'subscription',
        userId: '10',
        planId: '2',
        interval: 'MONTHLY',
        planCode: 'PLN_1',
        startAt: startAt.toISOString(),
      },
      customer: { email: 'owner@test', customer_code: 'CUS_1' },
      authorization: { authorization_code: 'AUTH_1', reusable },
    },
  });

  it('Paystack: covers the trial plus a month, renewing on the saved card', async () => {
    const t = setup({});
    await t.service.handlePaystackEvent(paystackCharge(true));
    const end = addInterval(startAt, 'MONTHLY');
    expect(t.created[0]).toMatchObject({ status: 'ACTIVE', end_date: end });
    expect(lastArg(t.createSubscription)).toEqual({
      customer: 'CUS_1',
      planCode: 'PLN_1',
      authorization: 'AUTH_1',
      startDate: end,
    });
    expect(t.prisma.subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { gateway_subscription_id: 'SUB_1', gateway_token: 'tok' },
      }),
    );
  });

  it("Paystack: a card that can't be reused leaves the plan non-renewing", async () => {
    const t = setup({});
    await t.service.handlePaystackEvent(paystackCharge(false));
    expect(t.createSubscription).not.toHaveBeenCalled();
    expect(t.prisma.subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { auto_renew: false } }),
    );
  });

  it('Stripe: access runs to the end of the trial, nothing charged yet', async () => {
    const t = setup({});
    await t.service.handleStripeEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          subscription: 'sub_1',
          customer: 'cus_1',
          metadata: {
            userId: '20',
            planId: '6',
            interval: 'MONTHLY',
            startAt: startAt.toISOString(),
          },
        },
      },
    } as unknown as Stripe.Event);
    expect(t.created[0]).toMatchObject({
      end_date: startAt,
      last_payment_date: null,
      gateway_subscription_id: 'sub_1',
    });
  });

  it("Stripe: the trial's $0 invoice isn't a payment", async () => {
    const t = setup({ current: { id: 99n, end_date: startAt } });
    await t.service.handleStripeEvent({
      type: 'invoice.paid',
      data: {
        object: { id: 'in_0', subscription: 'sub_1', amount_paid: 0 },
      },
    } as unknown as Stripe.Event);
    expect(t.prisma.payments.create).not.toHaveBeenCalled();
    expect(t.prisma.subscriptions.update).not.toHaveBeenCalled();
  });
});
