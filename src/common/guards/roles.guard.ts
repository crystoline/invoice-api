import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { AuthUser } from '../decorators/current-user.decorator';

/**
 * Enforces @Roles() metadata. Runs after JwtAuthGuard, so request.user is set.
 * Routes without @Roles() are unrestricted (any authenticated user), matching
 * the Spring controllers that only check roles in-code on specific endpoints.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    const granted = required.some((role) => user?.roles?.includes(role));
    if (!granted) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
