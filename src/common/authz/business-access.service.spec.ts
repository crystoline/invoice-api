import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '../enums/role.enum';
import { AuthUser } from '../decorators/current-user.decorator';
import { BusinessAccessService } from './business-access.service';
import { BusinessRole, Permission, ROLE_PERMISSIONS } from './permissions';

/*
 * Business 1: owner = user 10; members: 11 ADMIN, 12 MEMBER, 13 VIEWER.
 * Business 2: owner = user 20.
 * Invoice 100 → business 1, invoice 200 → business 2, bill 300 → no business (legacy).
 */
const businesses: Record<
  string,
  { owner: bigint; members: Record<string, string> }
> = {
  '1': {
    owner: 10n,
    members: { '11': 'ADMIN', '12': 'MEMBER', '13': 'VIEWER' },
  },
  '2': { owner: 20n, members: {} },
};
const invoiceBusiness: Record<string, bigint> = { '100': 1n, '200': 2n };

type ById = { where: { id: bigint } };
type BusinessQuery = ById & {
  select: { business_members: { where: { user_id: bigint } } };
};

const prisma = {
  businesses: {
    findUnique: jest.fn(({ where, select }: BusinessQuery) => {
      const b = businesses[String(where.id)];
      if (!b) return null;
      const uid = String(select.business_members.where.user_id);
      const role = b.members[uid];
      return { owner_id: b.owner, business_members: role ? [{ role }] : [] };
    }),
  },
  invoices: {
    findUnique: jest.fn(({ where }: ById) => {
      const biz = invoiceBusiness[String(where.id)];
      return biz ? { business_id: biz } : null;
    }),
  },
  bills: {
    findUnique: jest.fn(({ where }: ById) =>
      String(where.id) === '300' ? { business_id: null } : null,
    ),
  },
} as unknown as PrismaService;

const user = (id: number, roles: string[] = [Role.USER]): AuthUser => ({
  id: BigInt(id),
  email: `u${id}@x.test`,
  roles,
});

const access = new BusinessAccessService(prisma);

describe('permission table', () => {
  it('grants each role exactly the agreed permissions', () => {
    expect(ROLE_PERMISSIONS[BusinessRole.OWNER]).toEqual(
      Object.values(Permission),
    );
    expect(ROLE_PERMISSIONS[BusinessRole.ADMIN]).not.toContain(
      Permission.DELETE_BUSINESS,
    );
    expect(ROLE_PERMISSIONS[BusinessRole.ADMIN]).toContain(Permission.APPROVE);
    expect(ROLE_PERMISSIONS[BusinessRole.ADMIN]).toContain(
      Permission.MANAGE_MEMBERS,
    );
    expect(ROLE_PERMISSIONS[BusinessRole.MEMBER]).toEqual([
      Permission.VIEW,
      Permission.WRITE,
    ]);
    expect(ROLE_PERMISSIONS[BusinessRole.VIEWER]).toEqual([Permission.VIEW]);
  });
});

describe('BusinessAccessService.assert', () => {
  const ok = (uid: number, p: Permission) => access.assert(1n, user(uid), p);
  const denied = (uid: number, p: Permission) =>
    expect(access.assert(1n, user(uid), p)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

  it('lets the owner do everything, including deleting the business', async () => {
    await expect(ok(10, Permission.DELETE_BUSINESS)).resolves.toBe(
      BusinessRole.OWNER,
    );
  });

  it('lets an admin approve and manage members, but not delete the business', async () => {
    await expect(ok(11, Permission.APPROVE)).resolves.toBe(BusinessRole.ADMIN);
    await expect(ok(11, Permission.MANAGE_MEMBERS)).resolves.toBe(
      BusinessRole.ADMIN,
    );
    await denied(11, Permission.DELETE_BUSINESS);
  });

  it('lets a member write but not approve, delete or change settings', async () => {
    await expect(ok(12, Permission.WRITE)).resolves.toBe(BusinessRole.MEMBER);
    await denied(12, Permission.APPROVE);
    await denied(12, Permission.DELETE);
    await denied(12, Permission.MANAGE_SETTINGS);
  });

  it('keeps a viewer read-only', async () => {
    await expect(ok(13, Permission.VIEW)).resolves.toBe(BusinessRole.VIEWER);
    await denied(13, Permission.WRITE);
  });

  it('refuses someone outside the business — even another business owner', async () => {
    await denied(20, Permission.VIEW);
  });

  it('lets platform admins act in any business', async () => {
    await expect(
      access.assert(1n, user(99, [Role.ADMIN]), Permission.DELETE),
    ).resolves.toBeNull();
    await expect(
      access.assert(
        2n,
        user(98, [Role.SUPER_ADMIN]),
        Permission.MANAGE_SETTINGS,
      ),
    ).resolves.toBeNull();
  });

  it('refuses records that belong to no business, unless platform admin', async () => {
    await expect(
      access.assert(null, user(10), Permission.VIEW),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      access.assert(null, user(99, [Role.ADMIN]), Permission.VIEW),
    ).resolves.toBeNull();
  });

  it('404s an unknown business', async () => {
    await expect(
      access.assert(42n, user(10), Permission.VIEW),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('BusinessAccessService.resolveScope', () => {
  it('reads the business from a route param, query string or body', async () => {
    await expect(
      access.resolveScope(
        { param: 'businessId' },
        { params: { businessId: '1' } },
      ),
    ).resolves.toBe(1n);
    await expect(
      access.resolveScope(
        { query: 'businessId' },
        { query: { businessId: '2' } },
      ),
    ).resolves.toBe(2n);
    await expect(
      access.resolveScope({ body: 'businessId' }, { body: { businessId: 1 } }),
    ).resolves.toBe(1n);
  });

  it('traces a record back to its business', async () => {
    await expect(
      access.resolveScope(
        { resource: 'invoice', idParam: 'id' },
        { params: { id: '200' } },
      ),
    ).resolves.toBe(2n);
    await expect(
      access.resolveScope(
        { resource: 'invoice', idBody: 'invoiceId' },
        { body: { invoiceId: 100 } },
      ),
    ).resolves.toBe(1n);
  });

  it('refuses to reach a record through a business it does not belong to', async () => {
    // Invoice 200 is in business 2 — naming business 1 in the URL or body must not work.
    await expect(
      access.resolveScope(
        { resource: 'invoice', idParam: 'id', param: 'businessId' },
        { params: { id: '200', businessId: '1' } },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      access.resolveScope(
        { resource: 'invoice', idParam: 'id' },
        { params: { id: '200' }, body: { businessId: 1 } },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns null for a legacy record with no business', async () => {
    await expect(
      access.resolveScope(
        { resource: 'bill', idParam: 'id' },
        { params: { id: '300' } },
      ),
    ).resolves.toBeNull();
  });

  it('404s a missing record and 400s a missing or malformed id', async () => {
    await expect(
      access.resolveScope(
        { resource: 'invoice', idParam: 'id' },
        { params: { id: '999' } },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      access.resolveScope({ param: 'businessId' }, { params: {} }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      access.resolveScope(
        { param: 'businessId' },
        { params: { businessId: 'undefined' } },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      access.resolveScope(
        { resource: 'invoice', idParam: 'id' },
        { params: { id: '1 OR 1=1' } },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
