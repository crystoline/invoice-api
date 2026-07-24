import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * TOTP (RFC 6238) over HMAC-SHA1, plus the RFC 4648 base32 codec the otpauth://
 * format requires. Implemented directly on node:crypto rather than pulled from
 * a package: every TOTP library we tried shipped an ESM-only dependency, which
 * breaks `require()` on the Node 20 serverless runtime. This is ~60 lines of a
 * fully specified algorithm, verified against the RFC's published test vectors.
 */

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_DIGITS = 6;
const DEFAULT_PERIOD = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = String(input ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character in secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh base32 secret. 20 bytes = 160 bits, the RFC 4226 recommendation. */
export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

interface TotpOptions {
  digits?: number;
  period?: number;
  /** Unix seconds; defaults to now. */
  epochSeconds?: number;
}

/** The code for a given moment. */
export function generateToken(secret: string, opts: TotpOptions = {}): string {
  const digits = opts.digits ?? DEFAULT_DIGITS;
  const period = opts.period ?? DEFAULT_PERIOD;
  const epoch = opts.epochSeconds ?? Math.floor(Date.now() / 1000);

  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(epoch / period)));

  const digest = createHmac('sha1', base32Decode(secret))
    .update(counter)
    .digest();
  // Dynamic truncation (RFC 4226 §5.4).
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

interface VerifyOptions extends TotpOptions {
  /** Clock drift allowed either side, in seconds. Defaults to one period. */
  toleranceSeconds?: number;
}

/**
 * Constant-time check of a submitted code across the tolerated time window.
 * Returns false (never throws) for malformed input, so callers can fall through
 * to other credential types such as recovery codes.
 */
export function verifyToken(
  secret: string,
  token: string,
  opts: VerifyOptions = {},
): boolean {
  const digits = opts.digits ?? DEFAULT_DIGITS;
  const period = opts.period ?? DEFAULT_PERIOD;
  const tolerance = opts.toleranceSeconds ?? DEFAULT_PERIOD;

  const candidate = String(token ?? '').replace(/\D/g, '');
  if (!secret || candidate.length !== digits) return false;

  const now = opts.epochSeconds ?? Math.floor(Date.now() / 1000);
  const steps = Math.ceil(tolerance / period);
  const expectedBuf = Buffer.from(candidate);

  let matched = false;
  for (let i = -steps; i <= steps; i++) {
    let generated: string;
    try {
      generated = generateToken(secret, {
        digits,
        period,
        epochSeconds: now + i * period,
      });
    } catch {
      return false; // malformed secret
    }
    const genBuf = Buffer.from(generated);
    // Compare every candidate (no early exit) to keep the timing flat.
    if (
      genBuf.length === expectedBuf.length &&
      timingSafeEqual(genBuf, expectedBuf)
    ) {
      matched = true;
    }
  }
  return matched;
}

/** The otpauth:// URI that authenticator apps scan. */
export function keyUri(
  issuer: string,
  account: string,
  secret: string,
): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DEFAULT_DIGITS),
    period: String(DEFAULT_PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
