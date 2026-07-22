import { Injectable } from '@nestjs/common';
import { Prisma, roles_name } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { formatDateAdded } from '../common/util/date.util';
import {
  AdminCreateUserDto,
  CategoryRequestDto,
  PlanRequestDto,
  UpdateUserRoleDto,
} from './dto/admin.dto';

// --- shared helpers (mirroring dashboard.service conventions) --------------
const n = (d: Prisma.Decimal | null | undefined): number => (d != null ? Number(d) : 0);
const num = (v: number | null | undefined): number | null => (v == null ? null : Number(v));
const nb = (v: bigint | null | undefined): number => (v != null ? Number(v) : 0);
const pad = (x: number): string => String(x).padStart(2, '0');
const monthKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const DEFAULT_DURATION_DAYS = 30;

/** Parse the legacy string `date_added` ("yyyy-MM-dd HH:mm:ss") defensively. */
const parseDateAdded = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
};

type PageShape<T> = { content: T[]; page: number; size: number; totalElements: number; totalPages: number };
const pageOf = <T>(content: T[], page: number, size: number, totalElements: number): PageShape<T> => ({
  content,
  page,
  size,
  totalElements,
  totalPages: size > 0 ? Math.ceil(totalElements / size) : 0,
});

const usersWithRole = {
  user_role: { include: { roles: true } },
} satisfies Prisma.usersInclude;

const primaryRole = (u: { user_role: { roles: { name: roles_name | null } | null }[] }): string | null =>
  u.user_role?.[0]?.roles?.name ?? null;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // 1. GET /admin/stats -----------------------------------------------------
  async getStats(): Promise<ResponseObject> {
    try {
      const now = new Date();
      const [
        userRows,
        businessesCount,
        activeBusinesses,
        invoiceRows,
        subs,
        planRows,
        statusGroups,
        planGroups,
      ] = await Promise.all([
        this.prisma.users.findMany({ select: { date_added: true, verified: true } }),
        this.prisma.businesses.count(),
        this.prisma.businesses.count({ where: { is_active: true } }),
        this.prisma.invoices.findMany({
          select: { total_amount: true, amount_paid: true, is_paid: true, paid_date: true, invoice_date: true },
        }),
        this.prisma.subscriptions.findMany({
          where: { status: { in: ['ACTIVE', 'TRIAL'] } },
          include: { plans: true },
        }),
        this.prisma.plans.findMany(),
        this.prisma.subscriptions.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.subscriptions.groupBy({ by: ['plan_id'], _count: { _all: true } }),
      ]);

      const usersTotal = userRows.length;
      const verifiedUsers = userRows.filter((u) => u.verified).length;

      let invoiced = 0;
      let collected = 0;
      const revByMonth: Record<string, number> = {};
      for (const i of invoiceRows) {
        invoiced += n(i.total_amount);
        const paid = n(i.amount_paid);
        collected += paid;
        if (paid > 0) {
          const d = i.paid_date ?? i.invoice_date;
          if (d) revByMonth[monthKey(new Date(d))] = (revByMonth[monthKey(new Date(d))] || 0) + paid;
        }
      }
      const outstanding = invoiced - collected;

      // usersByMonth (last 12) — bucket by parsed date_added
      const usersMonthMap: Record<string, number> = {};
      for (const u of userRows) {
        const d = parseDateAdded(u.date_added);
        if (d) usersMonthMap[monthKey(d)] = (usersMonthMap[monthKey(d)] || 0) + 1;
      }
      const usersByMonth: { month: string; count: number }[] = [];
      const revenueByMonth: { month: string; collected: number }[] = [];
      for (let m = 11; m >= 0; m--) {
        const k = monthKey(new Date(now.getFullYear(), now.getMonth() - m, 1));
        usersByMonth.push({ month: k, count: usersMonthMap[k] || 0 });
        revenueByMonth.push({ month: k, collected: revByMonth[k] || 0 });
      }

      // mrr = sum of monthly NGN price over ACTIVE/TRIAL subscriptions
      const mrr = subs.reduce((s, sub) => s + (sub.plans?.price_ngn_monthly ?? 0), 0);
      const activeSubscriptions = subs.filter((s) => s.status === 'ACTIVE').length;

      const statusCount = (st: string): number =>
        statusGroups.find((g) => g.status === st)?._count._all ?? 0;
      const subscriptionStatus = {
        active: statusCount('ACTIVE'),
        trial: statusCount('TRIAL'),
        expired: statusCount('EXPIRED'),
        cancelled: statusCount('CANCELLED'),
      };

      const planNameById = new Map(planRows.map((p) => [p.id.toString(), p.display_name ?? p.name]));
      const planDistribution = planGroups.map((g) => ({
        plan: planNameById.get(g.plan_id.toString()) ?? 'Unknown',
        count: g._count._all,
      }));

      return ok('Admin stats fetched successfully', {
        totals: {
          users: usersTotal,
          businesses: businessesCount,
          activeBusinesses,
          verifiedUsers,
          invoices: invoiceRows.length,
          invoiced,
          collected,
          outstanding,
          activeSubscriptions,
          mrr,
        },
        usersByMonth,
        revenueByMonth,
        planDistribution,
        subscriptionStatus,
      });
    } catch (e) {
      return fail(`Failed to fetch admin stats: ${(e as Error).message}`);
    }
  }

  // 2. GET /admin/users -----------------------------------------------------
  async listUsers(
    search: string | undefined,
    role: string | undefined,
    status: boolean | undefined,
    page: number,
    size: number,
  ): Promise<ResponseObject> {
    try {
      const where: Prisma.usersWhereInput = {};
      if (search) {
        where.OR = [
          { email: { contains: search } },
          { first_name: { contains: search } },
          { last_name: { contains: search } },
        ];
      }
      if (role) where.user_role = { some: { roles: { name: role as roles_name } } };
      if (status !== undefined) where.status = status;

      const [rows, total] = await this.prisma.$transaction([
        this.prisma.users.findMany({
          where,
          skip: page * size,
          take: size,
          orderBy: { id: 'desc' },
          include: {
            ...usersWithRole,
            _count: { select: { businesses_businesses_owner_idTousers: true } },
          },
        }),
        this.prisma.users.count({ where }),
      ]);

      const content = rows.map((u) => ({
        id: nb(u.id),
        firstName: u.first_name,
        lastName: u.last_name,
        email: u.email,
        role: primaryRole(u),
        status: !!u.status,
        verified: !!u.verified,
        businessCount: u._count.businesses_businesses_owner_idTousers,
        dateAdded: u.date_added,
      }));
      return ok('Users fetched successfully', pageOf(content, page, size, total));
    } catch (e) {
      return fail(`Failed to fetch users: ${(e as Error).message}`);
    }
  }

  // 3. PATCH /admin/users/:id/status ---------------------------------------
  async setUserStatus(id: bigint, active: boolean): Promise<ResponseObject> {
    try {
      const user = await this.prisma.users.findUnique({ where: { id } });
      if (!user) return fail('User not found');
      await this.prisma.users.update({ where: { id }, data: { status: active } });
      return ok(`User status set to ${active}`);
    } catch (e) {
      return fail(`Failed to update user status: ${(e as Error).message}`);
    }
  }

  // 4. POST /admin/users/:id/verify ----------------------------------------
  async verifyUser(id: bigint): Promise<ResponseObject> {
    try {
      const user = await this.prisma.users.findUnique({ where: { id } });
      if (!user) return fail('User not found');
      await this.prisma.users.update({ where: { id }, data: { verified: true } });
      return ok('User verified successfully');
    } catch (e) {
      return fail(`Failed to verify user: ${(e as Error).message}`);
    }
  }

  // 5. PUT /admin/users/:id/role -------------------------------------------
  async setUserRole(id: bigint, dto: UpdateUserRoleDto): Promise<ResponseObject> {
    try {
      const user = await this.prisma.users.findUnique({ where: { id } });
      if (!user) return fail('User not found');
      const role = await this.prisma.roles.findFirst({ where: { name: dto.role as roles_name } });
      if (!role) return fail(`Role ${dto.role} not found`);
      // Replace all existing role links with the single new one.
      await this.prisma.$transaction([
        this.prisma.user_role.deleteMany({ where: { user_id: id } }),
        this.prisma.user_role.create({ data: { user_id: id, role_id: role.id } }),
      ]);
      return ok(`User role updated to ${dto.role}`);
    } catch (e) {
      return fail(`Failed to update user role: ${(e as Error).message}`);
    }
  }

  // 6. DELETE /admin/users/:id ---------------------------------------------
  async deleteUser(id: bigint): Promise<ResponseObject> {
    try {
      const user = await this.prisma.users.findUnique({ where: { id } });
      if (!user) return fail('User not found');
      // Remove role links first (FK NoAction), then the user itself. Users that
      // still own businesses / subscriptions will fail the FK and surface below.
      await this.prisma.user_role.deleteMany({ where: { user_id: id } });
      await this.prisma.users.delete({ where: { id } });
      return ok('User deleted successfully');
    } catch (e) {
      return fail(`Failed to delete user (they may still own businesses or subscriptions): ${(e as Error).message}`);
    }
  }

  // 7. POST /admin/users ----------------------------------------------------
  async createUser(dto: AdminCreateUserDto): Promise<ResponseObject> {
    try {
      const existing = await this.prisma.users.findFirst({ where: { email: dto.email } });
      if (existing) return fail('Email already exists.');

      const roleName = (dto.role ?? roles_name.ROLE_ADMIN) as roles_name;
      const role = await this.prisma.roles.findFirst({ where: { name: roleName } });
      if (!role) return fail(`Role ${roleName} not found`);

      const hashed = await bcrypt.hash(dto.password ?? '', 10);
      const created = await this.prisma.users.create({
        data: {
          username: dto.email,
          email: dto.email,
          first_name: dto.firstName,
          last_name: dto.lastName,
          password: hashed,
          status: true,
          verified: true,
          date_added: formatDateAdded(),
          user_role: { create: [{ roles: { connect: { id: role.id } } }] },
        },
        include: usersWithRole,
      });
      return ok('User created successfully', {
        id: nb(created.id),
        firstName: created.first_name,
        lastName: created.last_name,
        email: created.email,
        role: primaryRole(created),
        status: !!created.status,
        verified: !!created.verified,
        dateAdded: created.date_added,
      });
    } catch (e) {
      return fail(`Failed to create user: ${(e as Error).message}`);
    }
  }

  // 8. GET /admin/businesses ------------------------------------------------
  async listBusinesses(
    search: string | undefined,
    status: boolean | undefined,
    page: number,
    size: number,
  ): Promise<ResponseObject> {
    try {
      const where: Prisma.businessesWhereInput = {};
      if (search) {
        where.OR = [{ business_name: { contains: search } }, { business_email: { contains: search } }];
      }
      if (status !== undefined) where.is_active = status;

      const [rows, total] = await this.prisma.$transaction([
        this.prisma.businesses.findMany({
          where,
          skip: page * size,
          take: size,
          orderBy: { id: 'desc' },
          include: {
            users_businesses_owner_idTousers: true,
            _count: { select: { invoices: true } },
          },
        }),
        this.prisma.businesses.count({ where }),
      ]);

      // Revenue (sum amount_paid) per business, for just this page.
      const ids = rows.map((b) => b.id);
      const revGroups = ids.length
        ? await this.prisma.invoices.groupBy({
            by: ['business_id'],
            where: { business_id: { in: ids } },
            _sum: { amount_paid: true },
          })
        : [];
      const revById = new Map(revGroups.map((g) => [g.business_id.toString(), n(g._sum.amount_paid)]));

      const content = rows.map((b) => {
        const owner = b.users_businesses_owner_idTousers;
        return {
          id: nb(b.id),
          businessName: b.business_name,
          businessEmail: b.business_email,
          businessAddress: b.business_address,
          ownerName: owner ? `${owner.first_name ?? ''} ${owner.last_name ?? ''}`.trim() : null,
          ownerEmail: owner?.email ?? null,
          isActive: !!b.is_active,
          invoiceCount: b._count.invoices,
          revenue: revById.get(b.id.toString()) ?? 0,
          defaultCurrency: b.default_currency,
        };
      });
      return ok('Businesses fetched successfully', pageOf(content, page, size, total));
    } catch (e) {
      return fail(`Failed to fetch businesses: ${(e as Error).message}`);
    }
  }

  // 9. GET /admin/businesses/:id -------------------------------------------
  async getBusiness(id: bigint): Promise<ResponseObject> {
    try {
      const biz = await this.prisma.businesses.findUnique({
        where: { id },
        include: {
          users_businesses_owner_idTousers: true,
          business_members: { include: { users: { include: usersWithRole } } },
          _count: { select: { invoices: true, customers: true } },
        },
      });
      if (!biz) return fail('Business not found');

      const revAgg = await this.prisma.invoices.aggregate({
        where: { business_id: id },
        _sum: { amount_paid: true },
      });
      const owner = biz.users_businesses_owner_idTousers;
      const members = (biz.business_members ?? []).map((m) => {
        const u = m.users;
        return {
          name: u ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() : null,
          email: u?.email ?? null,
          role: u ? primaryRole(u) : null,
        };
      });

      return ok('Business fetched successfully', {
        id: nb(biz.id),
        businessName: biz.business_name,
        businessEmail: biz.business_email,
        businessAddress: biz.business_address,
        businessPhone: biz.business_phone,
        taxId: biz.tax_id,
        ownerName: owner ? `${owner.first_name ?? ''} ${owner.last_name ?? ''}`.trim() : null,
        ownerEmail: owner?.email ?? null,
        isActive: !!biz.is_active,
        defaultCurrency: biz.default_currency,
        invoiceCount: biz._count.invoices,
        customerCount: biz._count.customers,
        revenue: n(revAgg._sum.amount_paid),
        members,
      });
    } catch (e) {
      return fail(`Failed to fetch business: ${(e as Error).message}`);
    }
  }

  // 10. PATCH /admin/businesses/:id/status ---------------------------------
  async setBusinessStatus(id: bigint, active: boolean): Promise<ResponseObject> {
    try {
      const biz = await this.prisma.businesses.findUnique({ where: { id } });
      if (!biz) return fail('Business not found');
      await this.prisma.businesses.update({ where: { id }, data: { is_active: active } });
      return ok(`Business status set to ${active}`);
    } catch (e) {
      return fail(`Failed to update business status: ${(e as Error).message}`);
    }
  }

  // 11. DELETE /admin/businesses/:id ---------------------------------------
  async deleteBusiness(id: bigint): Promise<ResponseObject> {
    try {
      const biz = await this.prisma.businesses.findUnique({ where: { id } });
      if (!biz) return fail('Business not found');
      // Mirrors BusinessService.deleteBusiness: a plain delete. FK relations are
      // NoAction, so if child rows exist the DB rejects it — reported clearly.
      await this.prisma.businesses.delete({ where: { id } });
      return ok('Business deleted successfully');
    } catch (e) {
      return fail(`Failed to delete business (it may still have invoices, customers or other records): ${(e as Error).message}`);
    }
  }

  // 12. GET /admin/subscriptions -------------------------------------------
  async listSubscriptions(
    status: string | undefined,
    planId: string | undefined,
    page: number,
    size: number,
  ): Promise<ResponseObject> {
    try {
      const where: Prisma.subscriptionsWhereInput = {};
      if (status) where.status = status;
      if (planId) where.plan_id = BigInt(planId);

      const [rows, total] = await this.prisma.$transaction([
        this.prisma.subscriptions.findMany({
          where,
          skip: page * size,
          take: size,
          orderBy: { start_date: 'desc' },
          include: { users: true, plans: true },
        }),
        this.prisma.subscriptions.count({ where }),
      ]);

      const content = rows.map((s) => ({
        id: nb(s.id),
        userName: s.users ? `${s.users.first_name ?? ''} ${s.users.last_name ?? ''}`.trim() : null,
        userEmail: s.users?.email ?? null,
        planName: s.plans?.display_name ?? s.plans?.name ?? null,
        status: s.status,
        startDate: s.start_date ?? null,
        nextPaymentDate: s.next_payment_date ?? null,
        autoRenew: s.auto_renew,
      }));
      return ok('Subscriptions fetched successfully', pageOf(content, page, size, total));
    } catch (e) {
      return fail(`Failed to fetch subscriptions: ${(e as Error).message}`);
    }
  }

  // 13. GET /admin/plans (incl. inactive) ----------------------------------
  private mapPlan(p: import('@prisma/client').plans) {
    return {
      id: nb(p.id),
      name: p.name,
      displayName: p.display_name,
      description: p.description,
      priceNgnMonthly: num(p.price_ngn_monthly),
      priceNgnYearly: num(p.price_ngn_yearly),
      priceUsdMonthly: num(p.price_usd_monthly),
      priceUsdYearly: num(p.price_usd_yearly),
      maxInvoicesPerMonth: p.max_invoices_per_month,
      maxBusinesses: p.max_businesses,
      maxTeamMembers: p.max_team_members,
      allowPaymentCollection: p.allow_payment_collection,
      allowRecurringInvoices: p.allow_recurring_invoices,
      allowCustomTemplates: p.allow_custom_templates,
      allowApiAccess: p.allow_api_access,
      isActive: p.is_active,
    };
  }

  async listPlans(): Promise<ResponseObject> {
    try {
      const rows = await this.prisma.plans.findMany({ orderBy: { id: 'asc' } });
      return ok('Plans fetched successfully', rows.map((p) => this.mapPlan(p)));
    } catch (e) {
      return fail(`Failed to fetch plans: ${(e as Error).message}`);
    }
  }

  private toPlanData(dto: PlanRequestDto): Prisma.plansUncheckedCreateInput {
    return {
      name: dto.name ?? '',
      display_name: dto.displayName ?? dto.name,
      description: dto.description,
      duration_in_days: dto.durationInDays ?? DEFAULT_DURATION_DAYS,
      price: dto.priceNgnMonthly ?? 0,
      price_ngn_monthly: dto.priceNgnMonthly,
      price_ngn_yearly: dto.priceNgnYearly,
      price_usd_monthly: dto.priceUsdMonthly,
      price_usd_yearly: dto.priceUsdYearly,
      max_invoices_per_month: dto.maxInvoicesPerMonth ?? null,
      max_businesses: dto.maxBusinesses ?? null,
      max_team_members: dto.maxTeamMembers ?? null,
      allow_payment_collection: dto.allowPaymentCollection ?? false,
      allow_recurring_invoices: dto.allowRecurringInvoices ?? false,
      allow_custom_templates: dto.allowCustomTemplates ?? false,
      allow_api_access: dto.allowApiAccess ?? false,
      is_active: dto.isActive ?? true,
    };
  }

  // 14. POST /admin/plans ---------------------------------------------------
  async createPlan(dto: PlanRequestDto): Promise<ResponseObject> {
    try {
      if (!dto.name) return fail('Plan name is required');
      const existing = await this.prisma.plans.findUnique({ where: { name: dto.name } });
      if (existing) return fail(`Plan with name ${dto.name} already exists`);
      const created = await this.prisma.plans.create({ data: this.toPlanData(dto) });
      return ok('Plan created successfully', this.mapPlan(created));
    } catch (e) {
      return fail(`Failed to create plan: ${(e as Error).message}`);
    }
  }

  // 15a. PUT /admin/plans/:id ----------------------------------------------
  async updatePlan(id: bigint, dto: PlanRequestDto): Promise<ResponseObject> {
    try {
      const plan = await this.prisma.plans.findUnique({ where: { id } });
      if (!plan) return fail('Plan not found');
      const data: Prisma.plansUpdateInput = {
        name: dto.name ?? undefined,
        display_name: dto.displayName ?? undefined,
        description: dto.description ?? undefined,
        duration_in_days: dto.durationInDays ?? undefined,
        price: dto.priceNgnMonthly ?? undefined,
        price_ngn_monthly: dto.priceNgnMonthly ?? undefined,
        price_ngn_yearly: dto.priceNgnYearly ?? undefined,
        price_usd_monthly: dto.priceUsdMonthly ?? undefined,
        price_usd_yearly: dto.priceUsdYearly ?? undefined,
        max_invoices_per_month: dto.maxInvoicesPerMonth ?? undefined,
        max_businesses: dto.maxBusinesses ?? undefined,
        max_team_members: dto.maxTeamMembers ?? undefined,
        allow_payment_collection: dto.allowPaymentCollection ?? undefined,
        allow_recurring_invoices: dto.allowRecurringInvoices ?? undefined,
        allow_custom_templates: dto.allowCustomTemplates ?? undefined,
        allow_api_access: dto.allowApiAccess ?? undefined,
        is_active: dto.isActive ?? undefined,
      };
      const updated = await this.prisma.plans.update({ where: { id }, data });
      return ok('Plan updated successfully', this.mapPlan(updated));
    } catch (e) {
      return fail(`Failed to update plan: ${(e as Error).message}`);
    }
  }

  // 15b. PATCH /admin/plans/:id/active -------------------------------------
  async setPlanActive(id: bigint, active: boolean): Promise<ResponseObject> {
    try {
      const plan = await this.prisma.plans.findUnique({ where: { id } });
      if (!plan) return fail('Plan not found');
      await this.prisma.plans.update({ where: { id }, data: { is_active: active } });
      return ok(`Plan active set to ${active}`);
    } catch (e) {
      return fail(`Failed to update plan: ${(e as Error).message}`);
    }
  }

  // 15c. DELETE /admin/plans/:id -------------------------------------------
  async deletePlan(id: bigint): Promise<ResponseObject> {
    try {
      const plan = await this.prisma.plans.findUnique({ where: { id } });
      if (!plan) return fail('Plan not found');
      const refs = await this.prisma.subscriptions.count({ where: { plan_id: id } });
      if (refs > 0) {
        return fail(`Cannot delete plan: ${refs} subscription(s) still reference it. Deactivate it instead.`);
      }
      await this.prisma.plans.delete({ where: { id } });
      return ok('Plan deleted successfully');
    } catch (e) {
      return fail(`Failed to delete plan: ${(e as Error).message}`);
    }
  }

  // 16. GET/POST/PUT/DELETE /admin/categories ------------------------------
  async listCategories(): Promise<ResponseObject> {
    try {
      const rows = await this.prisma.categories.findMany({ orderBy: { id: 'asc' } });
      return ok('Categories fetched successfully', rows.map((c) => ({ id: nb(c.id), name: c.name, description: c.description })));
    } catch (e) {
      return fail(`Failed to fetch categories: ${(e as Error).message}`);
    }
  }

  async createCategory(dto: CategoryRequestDto): Promise<ResponseObject> {
    try {
      if (!dto.name) return fail('Category name is required');
      const existing = await this.prisma.categories.findUnique({ where: { name: dto.name } });
      if (existing) return fail(`Category ${dto.name} already exists`);
      const created = await this.prisma.categories.create({ data: { name: dto.name, description: dto.description } });
      return ok('Category created successfully', { id: nb(created.id), name: created.name, description: created.description });
    } catch (e) {
      return fail(`Failed to create category: ${(e as Error).message}`);
    }
  }

  async updateCategory(id: bigint, dto: CategoryRequestDto): Promise<ResponseObject> {
    try {
      const cat = await this.prisma.categories.findUnique({ where: { id } });
      if (!cat) return fail('Category not found');
      const updated = await this.prisma.categories.update({
        where: { id },
        data: { name: dto.name ?? undefined, description: dto.description ?? undefined },
      });
      return ok('Category updated successfully', { id: nb(updated.id), name: updated.name, description: updated.description });
    } catch (e) {
      return fail(`Failed to update category: ${(e as Error).message}`);
    }
  }

  async deleteCategory(id: bigint): Promise<ResponseObject> {
    try {
      const cat = await this.prisma.categories.findUnique({ where: { id } });
      if (!cat) return fail('Category not found');
      await this.prisma.categories.delete({ where: { id } });
      return ok('Category deleted successfully');
    } catch (e) {
      return fail(`Failed to delete category (it may still be referenced by products): ${(e as Error).message}`);
    }
  }

  // 17. GET /admin/activity -------------------------------------------------
  async getActivity(): Promise<ResponseObject> {
    try {
      type Item = { type: string; title: string; amount?: number; currency?: string | null; at: string | null };
      const [users, businesses, payments, invoices] = await Promise.all([
        this.prisma.users.findMany({
          select: { first_name: true, last_name: true, date_added: true },
          orderBy: { id: 'desc' },
          take: 20,
        }),
        this.prisma.businesses.findMany({
          orderBy: { id: 'desc' },
          take: 20,
          include: { users_businesses_owner_idTousers: { select: { date_added: true } } },
        }),
        this.prisma.payments.findMany({
          where: { status: 'SUCCESS' },
          orderBy: { paid_at: 'desc' },
          take: 20,
        }),
        this.prisma.invoices.findMany({ orderBy: { id: 'desc' }, take: 20 }),
      ]);

      const events: Item[] = [];

      for (const u of users) {
        const d = parseDateAdded(u.date_added);
        const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || 'user';
        events.push({ type: 'user_signup', title: `New user ${name}`, at: d ? d.toISOString() : null });
      }
      for (const b of businesses) {
        // businesses has no created_at; use the owner's date_added as a proxy.
        const d = parseDateAdded(b.users_businesses_owner_idTousers?.date_added);
        events.push({
          type: 'business_created',
          title: `New business ${b.business_name ?? ''}`.trim(),
          at: d ? d.toISOString() : null,
        });
      }
      for (const p of payments) {
        const at = p.paid_at ?? p.created_at;
        events.push({
          type: 'payment_received',
          title: 'Payment received',
          amount: n(p.amount),
          currency: p.currency ?? null,
          at: at ? new Date(at).toISOString() : null,
        });
      }
      for (const i of invoices) {
        events.push({
          type: 'invoice_created',
          title: `Invoice ${i.invoice_number ?? `#${nb(i.id)}`} created`,
          amount: n(i.total_amount),
          currency: i.currency_code ?? null,
          at: i.invoice_date ? new Date(i.invoice_date).toISOString() : null,
        });
      }

      // Sort by timestamp desc; undated events sink to the bottom.
      events.sort((a, b) => {
        if (a.at && b.at) return a.at < b.at ? 1 : a.at > b.at ? -1 : 0;
        if (a.at) return -1;
        if (b.at) return 1;
        return 0;
      });
      return ok('Activity fetched successfully', events.slice(0, 20));
    } catch (e) {
      return fail(`Failed to fetch activity: ${(e as Error).message}`);
    }
  }
}
