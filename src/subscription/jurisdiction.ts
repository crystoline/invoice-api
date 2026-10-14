/**
 * Billing jurisdiction. A user's billing country decides which plans they can
 * buy and how they pay. A business runs on its owner's plan, so it is the
 * owner's country that counts.
 *
 *   NG    → naira plans → pays in NGN → Paystack
 *   OTHER → USD plans   → pays in USD → Stripe
 */
export enum Jurisdiction {
  NG = 'NG',
  OTHER = 'OTHER',
}

export type Gateway = 'PAYSTACK' | 'STRIPE';
export type BillingInterval = 'MONTHLY' | 'YEARLY';

export const BILLING: Record<
  Jurisdiction,
  { currency: 'NGN' | 'USD'; gateway: Gateway }
> = {
  [Jurisdiction.NG]: { currency: 'NGN', gateway: 'PAYSTACK' },
  [Jurisdiction.OTHER]: { currency: 'USD', gateway: 'STRIPE' },
};

/** The jurisdiction for a billing country; null while the country is unknown. */
export const jurisdictionOf = (
  country: string | null | undefined,
): Jurisdiction | null =>
  !country
    ? null
    : country.toUpperCase() === 'NG'
      ? Jurisdiction.NG
      : Jurisdiction.OTHER;

export const isJurisdiction = (v: unknown): v is Jurisdiction =>
  v === Jurisdiction.NG || v === Jurisdiction.OTHER;

/** A scalar as text; anything else (objects, null) as ''. */
export const asText = (v: unknown): string =>
  typeof v === 'string'
    ? v
    : typeof v === 'number' || typeof v === 'bigint'
      ? String(v)
      : '';

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** A real ISO 3166-1 alpha-2 code (upper-cased), or null. */
export const normalizeCountry = (value: unknown): string | null => {
  const code = asText(value).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const name = regionNames.of(code);
  return name && name !== code && name !== 'Unknown Region' ? code : null;
};

export const parseInterval = (value: unknown): BillingInterval | null => {
  const v = asText(value).toUpperCase();
  return v === 'MONTHLY' || v === 'YEARLY' ? v : null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** End of one billing period starting at `from`. */
export const addInterval = (from: Date, interval: BillingInterval): Date => {
  const d = new Date(from);
  if (interval === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
};

export const daysFrom = (from: Date, days: number): Date =>
  new Date(from.getTime() + days * DAY_MS);

/** Major units → minor units (kobo / cents). */
export const toMinor = (amount: number): number => Math.round(amount * 100);
