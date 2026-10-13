import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, users } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { IMAGE_TYPES, StorageService } from '../storage/storage.service';
import { InvitationService } from './invitation.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { toSpringPage } from '../common/dto/page';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  ASSIGNABLE_ROLES,
  BusinessRole,
  Permission,
  ROLE_PERMISSIONS,
  isPlatformAdmin,
  toBusinessRole,
} from '../common/authz/permissions';
import { BusinessRequestDto, BusinessSettingsDto } from './dto/business.dto';

const ROLE_LABEL: Record<BusinessRole, string> = {
  [BusinessRole.OWNER]: 'Owner',
  [BusinessRole.ADMIN]: 'Admin',
  [BusinessRole.MEMBER]: 'Member',
  [BusinessRole.VIEWER]: 'Viewer',
};

// Access to every method here is decided by AuthorizationGuard from the route's
// @BusinessPermission / @Roles / @Authenticated declaration — the service only
// enforces rules that depend on the data itself (e.g. the owner can't be demoted).

const businessFull = {
  users_businesses_owner_idTousers: true,
  business_members: { include: { users: true } },
} satisfies Prisma.businessesInclude;
type BusinessFull = Prisma.businessesGetPayload<{
  include: typeof businessFull;
}>;

@Injectable()
export class BusinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly invitations: InvitationService,
    private readonly storage: StorageService,
  ) {}

  private mapUserEntity(u: users | null | undefined) {
    if (!u) return null;
    return {
      id: u.id,
      firstName: u.first_name,
      lastName: u.last_name,
      email: u.email,
      lastLogin: u.last_login,
      status: u.status,
      verified: u.verified,
      username: u.username,
    };
  }

  /** The viewer's role in `biz` (null for non-members, e.g. platform admins). */
  private roleIn(biz: BusinessFull, viewer: AuthUser): BusinessRole | null {
    if (biz.owner_id === viewer.id) return BusinessRole.OWNER;
    const m = biz.business_members.find((bm) => bm.user_id === viewer.id);
    return m ? toBusinessRole(m.role) : null;
  }

  private mapBusinessDTO(
    biz: BusinessFull,
    businessesOwned: (string | null)[] | null = null,
    viewer: AuthUser | null = null,
  ) {
    const owner = biz.users_businesses_owner_idTousers;
    const myRole = viewer ? this.roleIn(biz, viewer) : null;
    return {
      businessId: biz.id,
      userId: biz.owner_id,
      owner: owner
        ? `${owner.first_name ?? ''} ${owner.last_name ?? ''}`.trim()
        : null,
      businessEmail: biz.business_email,
      businessName: biz.business_name,
      businessAddress: biz.business_address,
      country: biz.country,
      businessRole: biz.business_role,
      isActive: biz.is_active, // fix: real state (legacy hardcoded true)
      businessPhone: biz.business_phone,
      taxId: biz.tax_id,
      logoUrl: biz.logo_url,
      defaultCurrency: biz.default_currency,
      paymentTermsDays: biz.payment_terms_days,
      invoicePrefix: biz.invoice_prefix,
      invoiceStartingNumber: biz.invoice_starting_number,
      testMode: biz.test_mode,
      paystackConnected: !!biz.paystack_secret_key, // never expose secret keys
      stripeConnected: !!biz.stripe_secret_key,
      businessesOwned,
      businessMembers: (biz.business_members ?? []).map((m) => ({
        ...this.mapUserEntity(m.users),
        role: toBusinessRole(m.role),
      })),
      // What the requesting user may do here — lets the UI hide what they can't.
      ...(viewer && {
        myRole,
        permissions: myRole
          ? ROLE_PERMISSIONS[myRole]
          : isPlatformAdmin(viewer)
            ? Object.values(Permission)
            : [],
      }),
    };
  }

  private isAdmin(user: AuthUser | null): boolean {
    return isPlatformAdmin(user);
  }

  private isOwnerOrMember(biz: BusinessFull, userId: bigint): boolean {
    if (biz.owner_id === userId) return true;
    return (biz.business_members ?? []).some((m) => m.user_id === userId);
  }

  // 4.1
  async createBusiness(
    dto: BusinessRequestDto,
    user: AuthUser | null,
  ): Promise<ResponseObject> {
    if (!user) return fail('User not found');
    try {
      if (
        dto.businessName &&
        (await this.prisma.businesses.findFirst({
          where: { business_name: dto.businessName },
        }))
      ) {
        return fail(`Business with name ${dto.businessName} already exists`);
      }
      if (
        dto.businessEmail &&
        (await this.prisma.businesses.findFirst({
          where: { business_email: dto.businessEmail },
        }))
      ) {
        return fail(`Business with email ${dto.businessEmail} already exists`);
      }
      const dbUser = await this.prisma.users.findUnique({
        where: { id: user.id },
      });
      if (!dbUser?.verified)
        return fail('Verify your account to add a business');

      const created = await this.prisma.businesses.create({
        data: {
          business_name: dto.businessName,
          business_email: dto.businessEmail,
          business_address: dto.businessAddress,
          country: dto.country,
          business_role: 'business_owner',
          is_active: true,
          owner_id: user.id,
        },
        include: businessFull,
      });
      const owned = await this.prisma.businesses.findMany({
        where: { owner_id: user.id },
      });
      return ok(
        'Business added successfully',
        this.mapBusinessDTO(
          created,
          owned.map((b) => b.business_name),
          user,
        ),
      );
    } catch (e) {
      return fail(`Failed  to add new business: ${(e as Error).message}`);
    }
  }

  // 4.2 — admin only
  async getAllBusinesses(user: AuthUser | null): Promise<ResponseObject> {
    try {
      if (!this.isAdmin(user)) {
        return fail(
          'Only an Admin user is allowed to fetch all businesses, call endpoint to fetch owner businesses',
        );
      }
      const all = await this.prisma.businesses.findMany({
        include: businessFull,
      });
      return ok(
        'Businesses fetched successfully',
        all.map((b) => this.mapBusinessDTO(b)),
      );
    } catch (e) {
      return fail(`Failed  to fetch businesses: ${(e as Error).message}`);
    }
  }

  // 4.3
  async getAllBusinessesPaginated(
    page: number,
    size: number,
  ): Promise<ResponseObject> {
    try {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.businesses.findMany({ skip: page * size, take: size }),
        this.prisma.businesses.count(),
      ]);
      return ok(
        'Paged Businesses fetched successfully',
        toSpringPage(items, page, size, total),
      );
    } catch (e) {
      return fail(`Failed  to fetch paged businesses: ${(e as Error).message}`);
    }
  }

  // 4.4
  async getAllBusinessesForOwner(
    user: AuthUser | null,
  ): Promise<ResponseObject> {
    try {
      const all = await this.prisma.businesses.findMany({
        where: { owner_id: user?.id },
        include: businessFull,
      });
      return ok(
        'Businesses fetched successfully for owner',
        all.map((b) => this.mapBusinessDTO(b, null, user)),
      );
    } catch (e) {
      return fail(
        `Failed  to fetch businesses for  owner: ${(e as Error).message}`,
      );
    }
  }

  /** Businesses the user owns or has joined, each carrying their role. */
  async getMyBusinesses(user: AuthUser): Promise<ResponseObject> {
    try {
      const all = await this.prisma.businesses.findMany({
        where: {
          OR: [
            { owner_id: user.id },
            { business_members: { some: { user_id: user.id } } },
          ],
        },
        include: businessFull,
        orderBy: { id: 'asc' },
      });
      return ok(
        'Businesses fetched successfully',
        all.map((b) => this.mapBusinessDTO(b, null, user)),
      );
    } catch (e) {
      return fail(`Failed to fetch businesses: ${(e as Error).message}`);
    }
  }

  // 4.5 — access checked by the guard (VIEW)
  async getBusiness(
    businessId: bigint,
    user: AuthUser,
  ): Promise<ResponseObject> {
    try {
      const biz = await this.prisma.businesses.findUnique({
        where: { id: businessId },
        include: businessFull,
      });
      if (!biz) return fail('Business not found');
      return ok(
        'Business fetched successfully',
        this.mapBusinessDTO(biz, null, user),
      );
    } catch (e) {
      return fail(`Failed  to fetch business: ${(e as Error).message}`);
    }
  }

  // 4.6 — set selectedBusiness (fixed owner-or-member guard)
  async switchBusiness(
    businessId: bigint,
    userId: bigint,
  ): Promise<ResponseObject> {
    const target = await this.prisma.users.findUnique({
      where: { id: userId },
    });
    if (!target)
      throw new NotFoundException(`User not found with id: ${userId}`);
    const biz = await this.prisma.businesses.findUnique({
      where: { id: businessId },
      include: businessFull,
    });
    if (!biz)
      throw new NotFoundException(`Business not found with id: ${businessId}`);
    if (!this.isOwnerOrMember(biz, userId)) {
      throw new ForbiddenException(
        'User is not authorized to access this business',
      );
    }
    await this.prisma.users.update({
      where: { id: userId },
      data: { selected_business_id: businessId },
    });
    return ok('Businesses switched successfully', this.mapBusinessDTO(biz));
  }

  // 4.7 — MANAGE_SETTINGS (guard)
  async updateBusiness(
    businessId: bigint,
    dto: BusinessRequestDto,
    user: AuthUser,
  ): Promise<ResponseObject> {
    const biz = await this.prisma.businesses.findUnique({
      where: { id: businessId },
    });
    if (!biz)
      throw new NotFoundException(`Business not found with id: ${businessId}`);
    try {
      const updated = await this.prisma.businesses.update({
        where: { id: businessId },
        data: {
          business_name: dto.businessName,
          business_address: dto.businessAddress,
        },
        include: businessFull,
      });
      return ok(
        'Businesses updated successfully',
        this.mapBusinessDTO(updated, null, user),
      );
    } catch (e) {
      return fail(`Failed  to update business: ${(e as Error).message}`);
    }
  }

  // 4.8 — MANAGE_MEMBERS (guard). The invitation carries the role granted on joining.
  async sendInvitation(
    businessId: bigint,
    email: string,
    role: string | undefined,
    user: AuthUser,
  ): Promise<ResponseObject> {
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
      return fail('Enter a valid email address.');
    const grant = String(
      role ?? BusinessRole.MEMBER,
    ).toUpperCase() as BusinessRole;
    if (!ASSIGNABLE_ROLES.includes(grant)) {
      return fail(
        `Role must be one of: ${ASSIGNABLE_ROLES.map((r) => r.toLowerCase()).join(', ')}`,
      );
    }
    try {
      const biz = await this.prisma.businesses.findUnique({
        where: { id: businessId },
      });
      if (!biz) return fail('Business not found.');
      const code = await this.invitations.create(
        businessId,
        address,
        grant,
        user.id,
      );
      // The link opens the web app's join page (it signs the user in first if needed).
      const frontend =
        this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
      const invitationUrl = `${frontend.replace(/\/+$/, '')}/api/join-business/${businessId}/${code}`;
      const inviter = await this.prisma.users.findUnique({
        where: { id: user.id },
      });
      const inviterName = [inviter?.first_name, inviter?.last_name]
        .filter(Boolean)
        .join(' ');
      await this.email.sendBusinessInvitationEmail(
        address,
        biz.business_name ?? 'a business',
        invitationUrl,
        ROLE_LABEL[grant],
        inviterName || undefined,
      );
      return ok('Invitation email sent successfully.');
    } catch (e) {
      return fail(`Error sending invitation: ${(e as Error).message}`);
    }
  }

  // 4.9 — the single-use invitation code is the credential; joins the caller.
  async joinBusiness(
    businessId: bigint,
    code: string,
    user: AuthUser,
  ): Promise<ResponseObject> {
    try {
      const biz = await this.prisma.businesses.findUnique({
        where: { id: businessId },
      });
      if (!biz) return fail('Business not found.');
      if (biz.owner_id === user.id)
        return fail('You already own this business.');
      const result = await this.invitations.redeem(businessId, code, user.id);
      if (result.status !== 'ok') {
        return fail(
          {
            missing: 'Invalid or expired invitation code.',
            expired: 'Invitation code has expired.',
            used: 'This invitation has already been used.',
          }[result.status],
        );
      }
      // Already a member? Keep their current role rather than silently changing it.
      const member = await this.prisma.business_members.upsert({
        where: {
          business_id_user_id: { business_id: businessId, user_id: user.id },
        },
        create: {
          business_id: businessId,
          user_id: user.id,
          role: result.role,
        },
        update: {},
      });
      return ok(`Successfully joined business: ${biz.business_name}`, {
        businessId,
        role: toBusinessRole(member.role),
      });
    } catch (e) {
      return fail(`Error Joining Business: ${(e as Error).message}`);
    }
  }

  /** Pending invitations — MANAGE_MEMBERS (guard). */
  async listInvitations(businessId: bigint): Promise<ResponseObject> {
    const pending = await this.invitations.listPending(businessId);
    const now = Date.now();
    return ok(
      'Invitations fetched successfully',
      pending.map((i) => ({
        id: i.id,
        email: i.email,
        role: toBusinessRole(i.role),
        expiresAt: i.expires_at,
        expired: i.expires_at.getTime() < now,
        createdAt: i.created_at,
      })),
    );
  }

  /** Revoke a pending invitation — MANAGE_MEMBERS (guard). */
  async revokeInvitation(
    businessId: bigint,
    invitationId: bigint,
  ): Promise<ResponseObject> {
    return (await this.invitations.revoke(businessId, invitationId))
      ? ok('Invitation revoked')
      : fail('Invitation not found or already accepted');
  }

  // 4.10 — destructive; hardened to SUPER_ADMIN at controller
  async deleteAllBusinesses(): Promise<ResponseObject> {
    await this.prisma.businesses.deleteMany({});
    return ok('All Businesses deleted successfully.');
  }

  // 4.11 — admin only
  async toggleBusinessStatus(
    businessId: bigint,
    user: AuthUser | null,
  ): Promise<ResponseObject> {
    try {
      if (!this.isAdmin(user))
        return fail('Only an  Admin is allowed to toggle business status');
      const biz = await this.prisma.businesses.findUnique({
        where: { id: businessId },
      });
      if (!biz) throw new Error('Business not found');
      const updated = await this.prisma.businesses.update({
        where: { id: businessId },
        data: { is_active: !biz.is_active },
      });
      return ok(`Business status toggled to: ${updated.is_active}`);
    } catch (e) {
      return fail(`Error toggling business status: ${(e as Error).message}`);
    }
  }

  // 4.12 — DELETE_BUSINESS (owner or platform admin; guard). 500 if id missing, per legacy.
  async deleteBusiness(businessId: bigint): Promise<ResponseObject> {
    const exists = await this.prisma.businesses.findUnique({
      where: { id: businessId },
    });
    if (!exists)
      throw new Error(`Business with id ${businessId} does not exist`);
    try {
      await this.prisma.businesses.delete({ where: { id: businessId } });
      return ok('Business deleted successfully.');
    } catch (e) {
      return fail(`Error trying to delete business: ${(e as Error).message}`);
    }
  }

  // 4.13 — VIEW (guard); businessId is a query param
  async getAllBusinessUsers(
    businessId: bigint,
    user: AuthUser,
  ): Promise<ResponseObject> {
    try {
      const biz = await this.prisma.businesses.findUnique({
        where: { id: businessId },
        include: businessFull,
      });
      if (!biz)
        return fail('Failed to fetch Business users: Business not found');
      const members = (biz.business_members ?? []).map((m) => {
        const u = m.users;
        return {
          id: u?.id ?? null,
          firstName: u?.first_name,
          lastName: u?.last_name,
          email: u?.email,
          role: toBusinessRole(m.role),
          userType: [] as unknown[],
          status: u?.status,
          verified: u?.verified,
          dateAdded: u?.date_added,
          lastLogin: u?.last_login,
        };
      });
      // Mark the caller's own row so clients can tell "you" apart.
      return ok(
        'Business Users fetched Successfully',
        members.map((m) => ({ ...m, isYou: m.id === user.id })),
      );
    } catch (e) {
      return fail(`Failed to fetch Business users: ${(e as Error).message}`);
    }
  }

  /**
   * Change a member's role — MANAGE_MEMBERS (guard). The owner isn't a member
   * row and can't be changed; nobody can change their own role (no self-promotion).
   */
  async setMemberRole(
    businessId: bigint,
    memberId: bigint,
    role: string,
    actor: AuthUser,
  ): Promise<ResponseObject> {
    const next = String(role ?? '').toUpperCase() as BusinessRole;
    if (!ASSIGNABLE_ROLES.includes(next)) {
      return fail(
        `Role must be one of: ${ASSIGNABLE_ROLES.map((r) => r.toLowerCase()).join(', ')}`,
      );
    }
    if (memberId === actor.id) return fail("You can't change your own role");
    const biz = await this.prisma.businesses.findUnique({
      where: { id: businessId },
      select: { owner_id: true },
    });
    if (!biz) return fail('Business not found');
    if (biz.owner_id === memberId)
      return fail("The business owner's role can't be changed");
    const key = {
      business_id_user_id: { business_id: businessId, user_id: memberId },
    };
    if (!(await this.prisma.business_members.findUnique({ where: key }))) {
      return fail('This user is not a member of the business');
    }
    await this.prisma.business_members.update({
      where: key,
      data: { role: next },
    });
    return ok('Member role updated', { userId: memberId, role: next });
  }

  /** Remove a member — MANAGE_MEMBERS (guard). The owner can't be removed. */
  async removeMember(
    businessId: bigint,
    memberId: bigint,
  ): Promise<ResponseObject> {
    const biz = await this.prisma.businesses.findUnique({
      where: { id: businessId },
      select: { owner_id: true },
    });
    if (!biz) return fail('Business not found');
    if (biz.owner_id === memberId)
      return fail("The business owner can't be removed");
    const removed = await this.prisma.business_members.deleteMany({
      where: { business_id: businessId, user_id: memberId },
    });
    if (!removed.count)
      return fail('This user is not a member of the business');
    // Don't leave them "inside" a business they no longer belong to.
    await this.prisma.users.updateMany({
      where: { id: memberId, selected_business_id: businessId },
      data: { selected_business_id: null },
    });
    return ok('Member removed from the business');
  }

  // 4.14 — VIEW (guard)
  async getAllBusinessCustomers(businessId: bigint): Promise<ResponseObject> {
    const biz = await this.prisma.businesses.findUnique({
      where: { id: businessId },
      include: { customers: true },
    });
    if (!biz) throw new NotFoundException('Business not found');
    try {
      const customers = biz.customers.map((c) => ({
        id: c.id,
        firstName: c.first_name,
        lastName: c.last_name,
        email: c.email,
        address: c.address,
        parentBusinessId: businessId,
      }));
      return ok('Business customers fetched successfully', customers);
    } catch (e) {
      return fail(
        `Failed to fetch Business customers: ${(e as Error).message}`,
      );
    }
  }

  // PUT /api/businesses/business/:businessId/settings — MANAGE_SETTINGS (guard)
  async updateSettings(
    businessId: bigint,
    dto: BusinessSettingsDto,
    user: AuthUser,
  ): Promise<ResponseObject> {
    const biz = await this.prisma.businesses.findUnique({
      where: { id: businessId },
    });
    if (!biz) return fail('Business not found');
    try {
      const updated = await this.prisma.businesses.update({
        where: { id: businessId },
        data: {
          business_name: dto.businessName ?? undefined,
          business_address: dto.businessAddress ?? undefined,
          business_email: dto.businessEmail ?? undefined,
          business_phone: dto.businessPhone ?? undefined,
          tax_id: dto.taxId ?? undefined,
          country: dto.country ?? undefined,
          default_currency: dto.defaultCurrency ?? undefined,
          payment_terms_days: dto.paymentTermsDays ?? undefined,
          invoice_prefix: dto.invoicePrefix ?? undefined,
          invoice_starting_number: dto.invoiceStartingNumber ?? undefined,
          paystack_public_key: dto.paystackPublicKey ?? undefined,
          paystack_secret_key: dto.paystackSecretKey ?? undefined,
          stripe_public_key: dto.stripePublicKey ?? undefined,
          stripe_secret_key: dto.stripeSecretKey ?? undefined,
          test_mode: dto.testMode ?? undefined,
        },
        include: businessFull,
      });
      return ok(
        'Settings updated successfully',
        this.mapBusinessDTO(updated, null, user),
      );
    } catch (e) {
      return fail(`Failed to update settings: ${(e as Error).message}`);
    }
  }

  // POST /api/businesses/business/:businessId/logo — MANAGE_SETTINGS (guard)
  async uploadLogo(
    businessId: bigint,
    file: Express.Multer.File,
  ): Promise<ResponseObject> {
    const biz = await this.prisma.businesses.findUnique({
      where: { id: businessId },
    });
    if (!biz) return fail('Business not found');
    try {
      const rel = await this.storage.storeFile(file, 'logos', IMAGE_TYPES);
      const base =
        this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:8080';
      const url = `${base}/uploads/${rel}`;
      await this.prisma.businesses.update({
        where: { id: businessId },
        data: { logo_url: url },
      });
      return ok('Logo uploaded successfully', { logoUrl: url });
    } catch (e) {
      return fail(`Failed to upload logo: ${(e as Error).message}`);
    }
  }
}
