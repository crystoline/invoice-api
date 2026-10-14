import {
  BILLING,
  Jurisdiction,
  addInterval,
  jurisdictionOf,
  normalizeCountry,
  parseInterval,
  toMinor,
} from './jurisdiction';

describe('billing jurisdiction', () => {
  it('Nigeria pays in naira via Paystack, everyone else in USD via Stripe', () => {
    expect(jurisdictionOf('NG')).toBe(Jurisdiction.NG);
    expect(jurisdictionOf('ng')).toBe(Jurisdiction.NG);
    expect(jurisdictionOf('GH')).toBe(Jurisdiction.OTHER);
    expect(jurisdictionOf('US')).toBe(Jurisdiction.OTHER);
    expect(BILLING[Jurisdiction.NG]).toEqual({
      currency: 'NGN',
      gateway: 'PAYSTACK',
    });
    expect(BILLING[Jurisdiction.OTHER]).toEqual({
      currency: 'USD',
      gateway: 'STRIPE',
    });
  });

  it('has no jurisdiction until the country is known', () => {
    expect(jurisdictionOf(null)).toBeNull();
    expect(jurisdictionOf('')).toBeNull();
  });

  it('accepts only real ISO 3166-1 alpha-2 codes', () => {
    expect(normalizeCountry(' ng ')).toBe('NG');
    expect(normalizeCountry('gb')).toBe('GB');
    expect(normalizeCountry('Nigeria')).toBeNull();
    expect(normalizeCountry('XX')).toBeNull();
    expect(normalizeCountry('ZZ')).toBeNull();
    expect(normalizeCountry({ code: 'NG' })).toBeNull();
    expect(normalizeCountry(undefined)).toBeNull();
  });

  it('parses billing intervals', () => {
    expect(parseInterval('monthly')).toBe('MONTHLY');
    expect(parseInterval('YEARLY')).toBe('YEARLY');
    expect(parseInterval('weekly')).toBeNull();
  });

  it('adds one billing period', () => {
    const from = new Date('2026-01-31T10:00:00Z');
    expect(addInterval(from, 'YEARLY').toISOString()).toBe(
      '2027-01-31T10:00:00.000Z',
    );
    expect(
      addInterval(new Date('2026-10-14T00:00:00Z'), 'MONTHLY').toISOString(),
    ).toBe('2026-11-14T00:00:00.000Z');
  });

  it('converts to minor units without float drift', () => {
    expect(toMinor(5000)).toBe(500000);
    expect(toMinor(19.99)).toBe(1999);
  });
});
