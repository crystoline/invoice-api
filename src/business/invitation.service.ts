import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessRole, toBusinessRole } from '../common/authz/permissions';

/** How long an emailed invitation stays valid. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type RedeemResult =
  | { status: 'ok'; role: BusinessRole }
  | { status: 'missing' | 'expired' | 'used' };

/**
 * Invitations to join a business, persisted in `business_invitations`
 * (the legacy store was an in-memory map: lost on restart and not shared
 * across instances). Codes are single-use, random, and carry the role the
 * invitee gets on joining.
 */
@Injectable()
export class InvitationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    businessId: bigint,
    email: string,
    role: BusinessRole,
    invitedBy: bigint,
  ): Promise<string> {
    const code = randomBytes(24).toString('base64url');
    await this.prisma.business_invitations.create({
      data: {
        business_id: businessId,
        email,
        role,
        code,
        invited_by: invitedBy,
        expires_at: new Date(Date.now() + INVITATION_TTL_MS),
      },
    });
    return code;
  }

  /** Consume a code for `userId`. Atomic: a code can only be accepted once. */
  async redeem(
    businessId: bigint,
    code: string,
    userId: bigint,
  ): Promise<RedeemResult> {
    const now = new Date();
    const claimed = await this.prisma.business_invitations.updateMany({
      where: {
        business_id: businessId,
        code,
        accepted_at: null,
        expires_at: { gt: now },
      },
      data: { accepted_at: now, accepted_by: userId },
    });
    const invite = await this.prisma.business_invitations.findFirst({
      where: { business_id: businessId, code },
    });
    if (!invite) return { status: 'missing' };
    if (claimed.count === 1)
      return { status: 'ok', role: toBusinessRole(invite.role) };
    return { status: invite.accepted_at ? 'used' : 'expired' };
  }

  /** Invitations not yet accepted (expired ones included, flagged by date). */
  listPending(businessId: bigint) {
    return this.prisma.business_invitations.findMany({
      where: { business_id: businessId, accepted_at: null },
      orderBy: { created_at: 'desc' },
    });
  }

  /** Revoke a pending invitation. Returns false if there was none to revoke. */
  async revoke(businessId: bigint, invitationId: bigint): Promise<boolean> {
    const { count } = await this.prisma.business_invitations.deleteMany({
      where: { id: invitationId, business_id: businessId, accepted_at: null },
    });
    return count === 1;
  }
}
