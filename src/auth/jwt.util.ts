/**
 * Faithful reproduction of the Spring `JwtUtils` token semantics.
 *
 * - HS256, signing key = Base64-DECODED bytes of the secret (the Spring code
 *   does `Decoders.BASE64.decode(secret)`), so JWT_SECRET must hold the same
 *   Base64 string the legacy app used for existing tokens to remain valid.
 * - 2h `exp`.
 * - Custom claims: token_type=access_token, email, last_activity.
 * - `last_activity` is the current Africa/Lagos wall-clock formatted
 *   "dd-MM-yyyy H:mm:ss" (24h hour, NO leading zero), and validation rejects a
 *   token whose last_activity is more than 30 minutes old — so effective token
 *   lifetime is ~30 min (matches the legacy behavior exactly).
 */
const LAGOS_TZ = 'Africa/Lagos';
const TWO_HOURS_SEC = 2 * 60 * 60;
export const INACTIVITY_MINUTES = 30;

/** Base64-decode the configured secret into raw HMAC key bytes. */
export function jwtKey(secretBase64: string): Buffer {
  return Buffer.from(secretBase64, 'base64');
}

/** Format a Date as the Lagos wall-clock string "dd-MM-yyyy H:mm:ss" (non-padded hour). */
export function formatLastActivity(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LAGOS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  // hour 'numeric' with hour12:false yields non-padded hour (except '24' -> '0')
  let hour = get('hour');
  if (hour === '24') hour = '0';
  return `${get('day')}-${get('month')}-${get('year')} ${hour}:${get('minute')}:${get('second')}`;
}

/** Parse a "dd-MM-yyyy H:mm:ss" Lagos wall-clock string to epoch millis (Lagos = UTC+1, no DST). */
export function parseLastActivity(value: string): number | null {
  const m = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yyyy, H, min, ss] = m.map(Number) as unknown as number[];
  // Lagos is UTC+1 → subtract 1h to get UTC.
  return Date.UTC(yyyy, mm - 1, dd, H - 1, min, ss);
}

/** True if the token's last_activity is more than 30 minutes in the past (→ invalid). */
export function isInactive(lastActivity: string | undefined, now: Date = new Date()): boolean {
  if (!lastActivity) return false; // no claim → not checked (matches Spring)
  const ms = parseLastActivity(lastActivity);
  if (ms === null) return true; // unparseable → treated as invalid
  return ms < now.getTime() - INACTIVITY_MINUTES * 60 * 1000;
}

/** Build the JWT payload (claims) for a user email, matching the legacy claim set. */
export function buildJwtPayload(email: string, now: Date = new Date()) {
  const iat = Math.floor(now.getTime() / 1000);
  return {
    sub: email,
    iat,
    exp: iat + TWO_HOURS_SEC,
    token_type: 'access_token',
    email,
    last_activity: formatLastActivity(now),
  };
}
