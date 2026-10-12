/**
 * Date helpers matching the legacy Spring formatting. The app used GMT+1
 * (== Africa/Lagos, no DST) for `dateAdded`/`lastLogin`, stored as strings.
 */
const LAGOS_TZ = 'Africa/Lagos';

/** "yyyy-MM-dd HH:mm:ss" in GMT+1 — the legacy `dateAdded` format. */
export function formatDateAdded(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LAGOS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
}

const DAY_MS = 86_400_000;

/** Midnight UTC of the calendar day `d` falls on (matches how @db.Date round-trips). */
const utcMidnight = (d: Date): number =>
  Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Parse a client-supplied date ("YYYY-MM-DD" or ISO). Blank/invalid → null. */
export function parseDateInput(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True when `due` falls on an earlier calendar day than `issue`. */
export function isBeforeDay(due: Date, issue: Date): boolean {
  return utcMidnight(due) < utcMidnight(issue);
}

/**
 * Carry an invoice's payment term (due − issue, in whole days) onto a new issue
 * date — used when an invoice is duplicated or generated from a recurring one.
 */
export function carryDueDate(
  issue: Date | null,
  due: Date | null,
  newIssue: Date,
): Date | null {
  if (!issue || !due) return null;
  const days = Math.max(
    Math.round((utcMidnight(due) - utcMidnight(issue)) / DAY_MS),
    0,
  );
  return new Date(utcMidnight(newIssue) + days * DAY_MS);
}
