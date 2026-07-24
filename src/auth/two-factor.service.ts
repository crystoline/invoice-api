import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateSecret, generateURI, verifySync } from 'otplib';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { AuthUser } from '../common/decorators/current-user.decorator';

const RECOVERY_CODE_COUNT = 10;
/** No 0/O/1/I — 32 chars, so `byte % 32` is bias-free over 256 values. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
/**
 * Drift allowance, in seconds (otplib v13 takes seconds, not step counts).
 * 30s = one period either side, so a slightly-off device clock still works.
 */
const TOTP_TOLERANCE_SECONDS = 30;

/**
 * TOTP two-factor authentication (RFC 6238) — the authenticator-app kind, so it
 * works with Google Authenticator, 1Password, Authy, etc.
 *
 * Enrolment is deliberately two-step: `beginSetup` stores a *pending* secret and
 * returns a QR code, and 2FA only switches on once `confirmSetup` sees a valid
 * code. That stops anyone locking themselves out with a secret they never
 * successfully scanned.
 *
 * Recovery codes are minted at confirm time, returned exactly once, and stored
 * only as bcrypt hashes — we can never show them again, by design.
 */
@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Current 2FA state for the settings screen. */
  async status(user: AuthUser): Promise<ResponseObject> {
    const dbUser = await this.prisma.users.findUnique({ where: { id: user.id } });
    if (!dbUser) return fail('User not found');
    const remaining = dbUser.twofa_enabled
      ? await this.prisma.user_recovery_codes.count({ where: { user_id: dbUser.id, used_at: null } })
      : 0;
    return ok('Two-factor status fetched', {
      enabled: !!dbUser.twofa_enabled,
      pendingSetup: !!dbUser.totp_secret && !dbUser.twofa_enabled,
      confirmedAt: dbUser.twofa_confirmed_at,
      recoveryCodesRemaining: remaining,
    });
  }

  /** Step 1 — mint a pending secret and hand back a QR to scan. */
  async beginSetup(user: AuthUser): Promise<ResponseObject> {
    const dbUser = await this.prisma.users.findUnique({ where: { id: user.id } });
    if (!dbUser) return fail('User not found');
    if (dbUser.twofa_enabled) {
      return fail('Two-factor authentication is already enabled. Turn it off first to re-enrol.');
    }

    const secret = generateSecret();
    const issuer = this.config.get<string>('APP_NAME') ?? 'Invoicing';
    const account = dbUser.email ?? dbUser.username ?? String(dbUser.id);
    const otpauthUrl = generateURI({ issuer, label: account, secret });

    await this.prisma.users.update({
      where: { id: dbUser.id },
      data: { totp_secret: secret, twofa_enabled: false, twofa_confirmed_at: null },
    });

    return ok('Scan the QR code with your authenticator app', {
      qrDataUrl: await QRCode.toDataURL(otpauthUrl),
      otpauthUrl,
      // Shown so the user can type it in if they cannot scan.
      secret,
      account,
      issuer,
    });
  }

  /** Step 2 — verify the first code, switch 2FA on, and return the recovery codes once. */
  async confirmSetup(user: AuthUser, code: string): Promise<ResponseObject> {
    const dbUser = await this.prisma.users.findUnique({ where: { id: user.id } });
    if (!dbUser) return fail('User not found');
    if (dbUser.twofa_enabled) return fail('Two-factor authentication is already enabled.');
    if (!dbUser.totp_secret) return fail('Start two-factor setup first.');
    if (!this.verifyTotp(dbUser.totp_secret, code)) {
      return fail('That code is not valid. Check your authenticator app and try again.');
    }

    const codes = this.generateRecoveryCodes();
    // Hash outside the transaction — bcrypt x10 would hold it open far too long.
    const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));

    await this.prisma.$transaction([
      this.prisma.user_recovery_codes.deleteMany({ where: { user_id: dbUser.id } }),
      this.prisma.user_recovery_codes.createMany({
        data: hashes.map((code_hash) => ({ user_id: dbUser.id, code_hash })),
      }),
      this.prisma.users.update({
        where: { id: dbUser.id },
        data: { twofa_enabled: true, twofa_confirmed_at: new Date() },
      }),
    ]);

    return ok('Two-factor authentication is now on', {
      recoveryCodes: codes,
      message: 'Save these now — they will not be shown again.',
    });
  }

  /** Turn 2FA off. Requires a current code (or a recovery code) to prove possession. */
  async disable(user: AuthUser, code: string): Promise<ResponseObject> {
    const dbUser = await this.prisma.users.findUnique({ where: { id: user.id } });
    if (!dbUser) return fail('User not found');
    if (!dbUser.twofa_enabled) return fail('Two-factor authentication is not enabled.');
    if (!(await this.verifyAny(dbUser.id, dbUser.totp_secret, code))) {
      return fail('That code is not valid.');
    }
    await this.prisma.$transaction([
      this.prisma.user_recovery_codes.deleteMany({ where: { user_id: dbUser.id } }),
      this.prisma.users.update({
        where: { id: dbUser.id },
        data: { totp_secret: null, twofa_enabled: false, twofa_confirmed_at: null },
      }),
    ]);
    return ok('Two-factor authentication has been turned off');
  }

  /** Replace the recovery codes, invalidating any unused ones. Shown once. */
  async regenerateRecoveryCodes(user: AuthUser, code: string): Promise<ResponseObject> {
    const dbUser = await this.prisma.users.findUnique({ where: { id: user.id } });
    if (!dbUser) return fail('User not found');
    if (!dbUser.twofa_enabled) return fail('Two-factor authentication is not enabled.');
    if (!this.verifyTotp(dbUser.totp_secret, code)) return fail('That code is not valid.');

    const codes = this.generateRecoveryCodes();
    const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
    await this.prisma.$transaction([
      this.prisma.user_recovery_codes.deleteMany({ where: { user_id: dbUser.id } }),
      this.prisma.user_recovery_codes.createMany({
        data: hashes.map((code_hash) => ({ user_id: dbUser.id, code_hash })),
      }),
    ]);
    return ok('New recovery codes generated', {
      recoveryCodes: codes,
      message: 'Your previous codes no longer work.',
    });
  }

  /**
   * Login-time check: a TOTP code, or a one-time recovery code (which is burned
   * on use). Used by AuthService after the password step.
   */
  async verifyForLogin(userId: bigint, secret: string | null, code: string): Promise<boolean> {
    return this.verifyAny(userId, secret, code);
  }

  // ---- internals -----------------------------------------------------------

  private async verifyAny(userId: bigint, secret: string | null, code: string): Promise<boolean> {
    if (this.verifyTotp(secret, code)) return true;
    return this.consumeRecoveryCode(userId, code);
  }

  private verifyTotp(secret: string | null, token: string): boolean {
    if (!secret || !token) return false;
    try {
      const result = verifySync({
        secret,
        token: String(token).replace(/\s+/g, ''),
        epochTolerance: TOTP_TOLERANCE_SECONDS,
      });
      return result.valid;
    } catch {
      // otplib throws on malformed input (e.g. a recovery code) — treat as a miss
      // so verifyAny can fall through to the recovery-code path.
      return false;
    }
  }

  /** Burn a matching unused recovery code. Returns true if one matched. */
  private async consumeRecoveryCode(userId: bigint, code: string): Promise<boolean> {
    const candidate = String(code ?? '').trim().toUpperCase();
    if (!candidate) return false;
    const rows = await this.prisma.user_recovery_codes.findMany({
      where: { user_id: userId, used_at: null },
    });
    for (const row of rows) {
      if (await bcrypt.compare(candidate, row.code_hash)) {
        await this.prisma.user_recovery_codes.update({
          where: { id: row.id },
          data: { used_at: new Date() },
        });
        this.logger.warn(`User ${userId} signed in with a recovery code.`);
        return true;
      }
    }
    return false;
  }

  private generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
    const group = (n: number) =>
      Array.from(randomBytes(n))
        .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
        .join('');
    return Array.from({ length: count }, () => `${group(4)}-${group(4)}`);
  }
}
