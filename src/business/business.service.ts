import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, users } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { StorageService } from '../storage/storage.service';
import { InvitationService } from './invitation.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { toSpringPage } from '../common/dto/page';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { BusinessRequestDto, BusinessSettingsDto } from './dto/business.dto';

const businessFull = {
  users_businesses_owner_idTousers: true,
  business_members: { include: { users: true } },
} satisfies Prisma.businessesInclude;
type BusinessFull = Prisma.businessesGetPayload<{ include: typeof businessFull }>;

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

  private mapBusinessDTO(biz: BusinessFull, businessesOwned: (string | null)[] | null = null) {
    const owner = biz.users_businesses_owner_idTousers;
    return {
      businessId: biz.id,
      userId: biz.owner_id,
      owner: owner ? `${owner.first_name ?? ''} ${owner.last_name ?? ''}`.trim() : null,
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
      businessMembers: (biz.business_members ?? []).map((m) => this.mapUserEntity(m.users)),
    };
  }

  private isAdmin(user: AuthUser | null): boolean {
    return !!user?.roles.includes(Role.ADMIN);
  }

  private isOwnerOrMember(biz: BusinessFull, userId: bigint): boolean {
    if (biz.owner_id === userId) return true;
    return (biz.business_members ?? []).some((m) => m.user_id === userId);
  }

  // 4.1
  async createBusiness(dto: BusinessRequestDto, user: AuthUser | null): Promise<ResponseObject> {
    if (!user) return fail('User not found');
    try {
      if (dto.businessName && (await this.prisma.businesses.findFirst({ where: { business_name: dto.businessName } }))) {
        return fail(`Business with name ${dto.businessName} already exists`);
      }
      if (dto.businessEmail && (await this.prisma.businesses.findFirst({ where: { business_email: dto.businessEmail } }))) {
        return fail(`Business with email ${dto.businessEmail} already exists`);
      }
      const dbUser = await this.prisma.users.findUnique({ where: { id: user.id } });
      if (!dbUser?.verified) return fail('Verify your account to add a business');

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
      const owned = await this.prisma.businesses.findMany({ where: { owner_id: user.id } });
      return ok('Business added successfully', this.mapBusinessDTO(created, owned.map((b) => b.business_name)));
    } catch (e) {
      return fail(`Failed  to add new business: ${(e as Error).message}`);
    }
  }

  // 4.2 — admin only
  async getAllBusinesses(user: AuthUser | null): Promise<ResponseObject> {
    try {
      if (!this.isAdmin(user)) {
        return fail('Only an Admin user is allowed to fetch all businesses, call endpoint to fetch owner businesses');
      }
      const all = await this.prisma.businesses.findMany({ include: businessFull });
      return ok('Businesses fetched successfully', all.map((b) => this.mapBusinessDTO(b)));
    } catch (e) {
      return fail(`Failed  to fetch businesses: ${(e as Error).message}`);
    }
  }

  // 4.3
  async getAllBusinessesPaginated(page: number, size: number): Promise<ResponseObject> {
    try {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.businesses.findMany({ skip: page * size, take: size }),
        this.prisma.businesses.count(),
      ]);
      return ok('Paged Businesses fetched successfully', toSpringPage(items, page, size, total));
    } catch (e) {
      return fail(`Failed  to fetch paged businesses: ${(e as Error).message}`);
    }
  }

  // 4.4
  async getAllBusinessesForOwner(user: AuthUser | null): Promise<ResponseObject> {
    try {
      const all = await this.prisma.businesses.findMany({ where: { owner_id: user?.id }, include: businessFull });
      return ok('Businesses fetched successfully for owner', all.map((b) => this.mapBusinessDTO(b)));
    } catch (e) {
      return fail(`Failed  to fetch businesses for  owner: ${(e as Error).message}`);
    }
  }

  // 4.5 — owner or member
  async getBusiness(businessId: bigint, user: AuthUser | null): Promise<ResponseObject> {
    try {
      const biz = await this.prisma.businesses.findUnique({ where: { id: businessId }, include: businessFull });
      if (!biz) return fail('Business not found');
      if (!user || !this.isOwnerOrMember(biz, user.id)) {
        return fail('Only Owner  or Member is allowed to fetch business');
      }
      return ok('Business fetched successfully', this.mapBusinessDTO(biz));
    } catch (e) {
      return fail(`Failed  to fetch business: ${(e as Error).message}`);
    }
  }

  // 4.6 — set selectedBusiness (fixed owner-or-member guard)
  async switchBusiness(businessId: bigint, userId: bigint): Promise<ResponseObject> {
    const target = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException(`User not found with id: ${userId}`);
    const biz = await this.prisma.businesses.findUnique({ where: { id: businessId }, include: businessFull });
    if (!biz) throw new NotFoundException(`Business not found with id: ${businessId}`);
    if (!this.isOwnerOrMember(biz, userId)) {
      throw new ForbiddenException('User is not authorized to access this business');
    }
    await this.prisma.users.update({ where: { id: userId }, data: { selected_business_id: businessId } });
    return ok('Businesses switched successfully', this.mapBusinessDTO(biz));
  }

  // 4.7 — owner only (404/403 for not-found/not-authorized)
  async updateBusiness(businessId: bigint, dto: BusinessRequestDto, user: AuthUser | null): Promise<ResponseObject> {
    const biz = await this.prisma.businesses.findUnique({ where: { id: businessId }, include: businessFull });
    if (!biz) throw new NotFoundException(`Business not found with id: ${businessId}`);
    const isOwner = biz.owner_id === user?.id;
    if (!isOwner && !this.isAdmin(user)) throw new ForbiddenException('Access denied');
    try {
      if (!isOwner) return fail('Only Business owner is allowed to update this business');
      const updated = await this.prisma.businesses.update({
        where: { id: businessId },
        data: { business_name: dto.businessName, business_address: dto.businessAddress },
        include: businessFull,
      });
      return ok('Businesses updated successfully', this.mapBusinessDTO(updated));
    } catch (e) {
      return fail(`Failed  to update business: ${(e as Error).message}`);
    }
  }

  // 4.8 — owner only
  async sendInvitation(businessId: bigint, email: string, user: AuthUser | null): Promise<ResponseObject> {
    try {
      const biz = await this.prisma.businesses.findUnique({ where: { id: businessId } });
      if (!biz) return fail('Business not found.');
      if (biz.owner_id !== user?.id) return fail("You don't have privilege to invite users.");
      const code = this.invitations.generateAndStore(businessId);
      const base = this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:8080';
      const invitationUrl = `${base}/api/businesses/join-business/${businessId}/${code}`; // fixed segment
      const inviter = user ? await this.prisma.users.findUnique({ where: { id: user.id } }) : null;
      const inviterName = [inviter?.first_name, inviter?.last_name].filter(Boolean).join(' ');
      await this.email.sendBusinessInvitationEmail(
        email,
        biz.business_name ?? 'a business',
        code,
        invitationUrl,
        inviterName || undefined,
      );
      return ok('Invitation email sent successfully.');
    } catch (e) {
      return fail(`Error sending invitation: ${(e as Error).message}`);
    }
  }

  // 4.9
  async joinBusiness(businessId: bigint, code: string, user: AuthUser | null): Promise<ResponseObject> {
    try {
      if (!user) return fail('Sign up to join business');
      const biz = await this.prisma.businesses.findUnique({ where: { id: businessId } });
      if (!biz) return fail('Business not found.');
      const result = this.invitations.validate(businessId, code);
      if (result === 'missing') return fail('Invalid or expired invitation code.');
      if (result === 'expired') return fail('Invitation code has expired.');
      await this.prisma.business_members.upsert({
        where: { business_id_user_id: { business_id: businessId, user_id: user.id } },
        create: { business_id: businessId, user_id: user.id },
        update: {},
      });
      return ok(`Successfully joined business: ${biz.business_name}`);
    } catch (e) {
      return fail(`Error Joining Business: ${(e as Error).message}`);
    }
  }

  // 4.10 — destructive; hardened to SUPER_ADMIN at controller
  async deleteAllBusinesses(): Promise<ResponseObject> {
    await this.prisma.businesses.deleteMany({});
    return ok('All Businesses deleted successfully.');
  }

  // 4.11 — admin only
  async toggleBusinessStatus(businessId: bigint, user: AuthUser | null): Promise<ResponseObject> {
    try {
      if (!this.isAdmin(user)) return fail('Only an  Admin is allowed to toggle business status');
      const biz = await this.prisma.businesses.findUnique({ where: { id: businessId } });
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

  // 4.12 — admin only (500 if id missing, per legacy)
  async deleteBusiness(businessId: bigint, user: AuthUser | null): Promise<ResponseObject> {
    const exists = await this.prisma.businesses.findUnique({ where: { id: businessId } });
    if (!exists) throw new Error(`Business with id ${businessId} does not exist`);
    try {
      if (!this.isAdmin(user)) return fail('you need admin privilege to delete business ');
      await this.prisma.businesses.delete({ where: { id: businessId } });
      return ok('Business deleted successfully.');
    } catch (e) {
      return fail(`Error trying to delete business: ${(e as Error).message}`);
    }
  }

  // 4.13 — owner or admin; businessId is a query param
  async getAllBusinessUsers(businessId: bigint | undefined, user: AuthUser | null): Promise<ResponseObject> {
    try {
      if (businessId === undefined) return fail('Failed to fetch Business users: businessId is required');
      const biz = await this.prisma.businesses.findUnique({ where: { id: businessId }, include: businessFull });
      if (!biz) return fail('Failed to fetch Business users: Business not found');
      const isOwner = biz.owner_id === user?.id;
      if (!isOwner && !this.isAdmin(user)) return fail('Failed to fetch Business users: Access denied');
      const members = (biz.business_members ?? []).map((m) => {
        const u = m.users;
        return {
          id: null,
          firstName: u?.first_name,
          lastName: u?.last_name,
          email: u?.email,
          userType: [] as unknown[],
          status: u?.status,
          verified: u?.verified,
          dateAdded: u?.date_added,
          lastLogin: u?.last_login,
        };
      });
      return ok('Business Users fetched Successfully', members);
    } catch (e) {
      return fail(`Failed to fetch Business users: ${(e as Error).message}`);
    }
  }

  // 4.14 — owner only (404/403)
  async getAllBusinessCustomers(businessId: bigint, user: AuthUser | null): Promise<ResponseObject> {
    const biz = await this.prisma.businesses.findUnique({ where: { id: businessId }, include: { customers: true } });
    if (!biz) throw new NotFoundException('Business not found');
    if (biz.owner_id !== user?.id) throw new ForbiddenException('Access denied');
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
      return fail(`Failed to fetch Business customers: ${(e as Error).message}`);
    }
  }

  // PUT /api/businesses/business/:businessId/settings
  async updateSettings(businessId: bigint, dto: BusinessSettingsDto, user: AuthUser | null): Promise<ResponseObject> {
    const biz = await this.prisma.businesses.findUnique({ where: { id: businessId } });
    if (!biz) return fail('Business not found');
    if (biz.owner_id !== user?.id && !this.isAdmin(user)) return fail('Access denied');
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
      return ok('Settings updated successfully', this.mapBusinessDTO(updated));
    } catch (e) {
      return fail(`Failed to update settings: ${(e as Error).message}`);
    }
  }

  // POST /api/businesses/business/:businessId/logo
  async uploadLogo(businessId: bigint, file: Express.Multer.File, user: AuthUser | null): Promise<ResponseObject> {
    const biz = await this.prisma.businesses.findUnique({ where: { id: businessId } });
    if (!biz) return fail('Business not found');
    if (biz.owner_id !== user?.id && !this.isAdmin(user)) return fail('Access denied');
    try {
      const rel = await this.storage.storeFile(file, 'logos');
      const base = this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:8080';
      const url = `${base}/uploads/${rel}`;
      await this.prisma.businesses.update({ where: { id: businessId }, data: { logo_url: url } });
      return ok('Logo uploaded successfully', { logoUrl: url });
    } catch (e) {
      return fail(`Failed to upload logo: ${(e as Error).message}`);
    }
  }
}
