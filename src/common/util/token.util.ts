import { randomBytes } from 'crypto';

/**
 * Email verification / password-reset token — mirrors the legacy
 * VerificationTokenUtil: 64 random bytes, URL-safe Base64 without padding.
 */
export function generateVerificationToken(): string {
  return randomBytes(64).toString('base64url');
}
