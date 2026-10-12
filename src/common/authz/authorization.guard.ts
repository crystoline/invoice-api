import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthUser } from '../decorators/current-user.decorator';
import {
  AUTHENTICATED_KEY,
  BUSINESS_POLICY_KEY,
  BusinessPolicy,
} from './authz.decorators';
import { BusinessAccessService } from './business-access.service';

/**
 * Global authorization guard (runs after JwtAuthGuard and RolesGuard).
 *
 * Fails closed: every route must declare who may call it — @Public(),
 * platform @Roles(...), @Authenticated() (caller's own data only), or
 * @BusinessPermission(...). A route with none of these is refused, so a new
 * endpoint can't ship without an access decision. (route-policy.spec.ts
 * catches that in CI before it ever reaches a request.)
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  private readonly logger = new Logger(AuthorizationGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly access: BusinessAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const meta = <T>(key: string) =>
      this.reflector.getAllAndOverride<T>(key, targets);

    if (meta<boolean>(IS_PUBLIC_KEY)) return true;

    const policy = meta<BusinessPolicy>(BUSINESS_POLICY_KEY);
    const roles = meta<string[]>(ROLES_KEY);
    const selfScoped = meta<boolean>(AUTHENTICATED_KEY);

    if (!policy && !roles?.length && !selfScoped) {
      this.logger.error(
        `${context.getClass().name}.${context.getHandler().name} has no access policy — request refused`,
      );
      throw new ForbiddenException('This endpoint has no access policy.');
    }
    if (!policy) return true; // @Roles is enforced by RolesGuard

    const req = context.switchToHttp().getRequest<{
      user: AuthUser;
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      body?: unknown;
    }>();
    const businessId = await this.access.resolveScope(policy.scope, req);
    await this.access.assert(businessId, req.user, policy.permission);
    return true;
  }
}
