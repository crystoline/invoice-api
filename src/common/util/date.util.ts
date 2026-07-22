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
