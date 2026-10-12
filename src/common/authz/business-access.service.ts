import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../decorators/current-user.decorator';
import { BusinessScope, ResourceKind } from './authz.decorators';
import {
  BusinessRole,
  Permission,
  deniedMessage,
  isPlatformAdmin,
  roleCan,
  toBusinessRole,
} from './permissions';

/** The slice of an HTTP request the scope resolver reads. */
export interface ScopedRequest {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
}

const RESOURCE_LABEL: Record<ResourceKind, string> = {
  invoice: 'Invoice',
  bill: 'Bill',
  customer: 'Customer',
  product: 'Product',
  income: 'Income record',
  expenseCategory: 'Expense category',
  taxRate: 'Tax rate',
  vendor: 'Vendor',
  vendorProduct: 'Vendor product',
  recurringInvoice: 'Recurring invoice',
  paymentReference: 'Payment',
};

const present = (v: unknown): boolean =>
  v !== undefined && v !== null && v !== '';

/** Parse an id from a path/query/body value; anything but a positive integer is a 400. */
export const parseId = (value: unknown, name = 'id'): bigint => {
  const s = String(value).trim();
  if (!/^\d+$/.test(s) || s === '0') {
    throw new BadRequestException(`Invalid ${name}`);
  }
  return BigInt(s);
};

/**
 * Answers "may this user do X in business B?" from one permission table
 * (see permissions.ts), and traces records back to the business that owns
 * them. Used by AuthorizationGuard for every business-scoped route, and by
 * services for the few checks that depend on request data (e.g. member roles).
 */
@Injectable()
export class BusinessAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** The user's role in the business, or null when they don't belong to it. */
  async roleOf(
    businessId: bigint,
    userId: bigint,
  ): Promise<BusinessRole | null> {
    const biz = await this.prisma.businesses.findUnique({
      where: { id: businessId },
      select: {
        owner_id: true,
        business_members: {
          where: { user_id: userId },
          select: { role: true },
        },
      },
    });
    if (!biz) throw new NotFoundException('Business not found');
    if (biz.owner_id === userId) return BusinessRole.OWNER;
    const membership = biz.business_members[0];
    return membership ? toBusinessRole(membership.role) : null;
  }

  /**
   * Throw unless the user may exercise `permission` in the business. Returns
   * their role (null for platform admins, who may act in any business).
   */
  async assert(
    businessId: bigint | null,
    user: AuthUser,
    permission: Permission,
  ): Promise<BusinessRole | null> {
    if (isPlatformAdmin(user)) return null;
    if (businessId == null) {
      // Legacy rows that were never tied to a business.
      throw new ForbiddenException(
        'This record does not belong to a business you are a member of.',
      );
    }
    const role = await this.roleOf(businessId, user.id);
    if (!role) {
      throw new ForbiddenException('You do not have access to this business.');
    }
    if (!roleCan(role, permission)) {
      throw new ForbiddenException(deniedMessage(role, permission));
    }
    return role;
  }

  /** Business that owns a record. 404 when the record doesn't exist. */
  async businessOf(kind: ResourceKind, rawId: unknown): Promise<bigint | null> {
    const label = RESOURCE_LABEL[kind];
    const found = await this.lookup(kind, rawId);
    if (!found) throw new NotFoundException(`${label} not found`);
    return found.businessId;
  }

  /**
   * Resolve the business a request targets. A record named by the route wins;
   * any business id the caller also supplies must match it.
   */
  async resolveScope(
    scope: BusinessScope,
    req: ScopedRequest,
  ): Promise<bigint | null> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const direct =
      (scope.param && req.params?.[scope.param]) ??
      (scope.query && req.query?.[scope.query]) ??
      (scope.body && body[scope.body]);

    if (scope.resource) {
      const idName = scope.idParam ?? scope.idBody ?? 'id';
      const rawId = scope.idParam
        ? req.params?.[scope.idParam]
        : body[scope.idBody ?? ''];
      if (!present(rawId))
        throw new BadRequestException(`${idName} is required`);
      const owner = await this.businessOf(scope.resource, rawId);
      for (const claimed of [direct, body.businessId]) {
        if (present(claimed) && parseId(claimed, 'businessId') !== owner) {
          // Same answer as "doesn't exist" — don't confirm it lives elsewhere.
          throw new NotFoundException(
            `${RESOURCE_LABEL[scope.resource]} not found`,
          );
        }
      }
      return owner;
    }

    if (!present(direct))
      throw new BadRequestException('businessId is required');
    return parseId(direct, 'businessId');
  }

  private async lookup(
    kind: ResourceKind,
    rawId: unknown,
  ): Promise<{ businessId: bigint | null } | null> {
    const p = this.prisma;
    const by = (row: { business_id: bigint | null } | null) =>
      row && { businessId: row.business_id };

    if (kind === 'paymentReference') {
      const ref = String(rawId);
      return by(
        await p.payments.findFirst({
          where: { transaction_ref: ref },
          select: { business_id: true },
        }),
      );
    }

    const id = parseId(rawId);
    const select = { business_id: true } as const;
    switch (kind) {
      case 'invoice':
        return by(await p.invoices.findUnique({ where: { id }, select }));
      case 'bill':
        return by(await p.bills.findUnique({ where: { id }, select }));
      case 'customer':
        return by(await p.customers.findUnique({ where: { id }, select }));
      case 'product':
        return by(await p.products.findUnique({ where: { id }, select }));
      case 'income':
        return by(await p.income.findUnique({ where: { id }, select }));
      case 'expenseCategory':
        return by(
          await p.expense_categories.findUnique({ where: { id }, select }),
        );
      case 'taxRate':
        return by(await p.tax_rates.findUnique({ where: { id }, select }));
      case 'vendor':
        return by(await p.vendors.findUnique({ where: { id }, select }));
      case 'vendorProduct': {
        const vp = await p.vendor_products.findUnique({
          where: { id },
          select: { vendors: { select } },
        });
        return vp && { businessId: vp.vendors.business_id };
      }
      case 'recurringInvoice': {
        // Older schedules may predate recurringinvoices.business_id — fall
        // back to the template invoice's business.
        const r = await p.recurringinvoices.findUnique({
          where: { id },
          select: { business_id: true, invoices: { select } },
        });
        return (
          r && { businessId: r.business_id ?? r.invoices?.business_id ?? null }
        );
      }
    }
  }
}
