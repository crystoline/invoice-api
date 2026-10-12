import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { AuthorizationGuard } from './authorization.guard';
import { Authenticated, BusinessPermission } from './authz.decorators';
import { BusinessAccessService } from './business-access.service';
import { Permission } from './permissions';

class Routes {
  unannotated() {}
  @Public() open() {}
  @Roles(Role.ADMIN) staff() {}
  @Authenticated() mine() {}
  @BusinessPermission(Permission.WRITE, { param: 'businessId' })
  write() {}
}

const resolveScope = jest.fn().mockResolvedValue(7n);
const assert = jest.fn().mockResolvedValue('MEMBER');
const access = { resolveScope, assert } as unknown as BusinessAccessService;

const guard = new AuthorizationGuard(new Reflector(), access);

const ctx = (handler: keyof Routes, req: object = {}): ExecutionContext =>
  ({
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

describe('AuthorizationGuard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fails closed on a route with no access policy', async () => {
    await expect(guard.canActivate(ctx('unannotated'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('passes @Public, @Roles (RolesGuard enforces) and @Authenticated routes', async () => {
    for (const h of ['open', 'staff', 'mine'] as const) {
      await expect(guard.canActivate(ctx(h))).resolves.toBe(true);
    }
    expect(assert).not.toHaveBeenCalled();
  });

  it('checks the caller against the business a route resolves to', async () => {
    const req = { user: { id: 5n, roles: [] }, params: { businessId: '7' } };
    await expect(guard.canActivate(ctx('write', req))).resolves.toBe(true);
    expect(resolveScope).toHaveBeenCalledWith({ param: 'businessId' }, req);
    expect(assert).toHaveBeenCalledWith(7n, req.user, Permission.WRITE);
  });

  it('propagates a denial', async () => {
    assert.mockRejectedValueOnce(new ForbiddenException('no'));
    await expect(
      guard.canActivate(ctx('write', { user: { id: 5n, roles: [] } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
