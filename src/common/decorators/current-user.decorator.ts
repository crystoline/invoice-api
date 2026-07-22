import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: bigint;
  email: string;
  roles: string[];
}

/**
 * Injects the authenticated user (set on the request by JwtStrategy) into a
 * handler param. Analogous to Spring's SecurityContext principal.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | AuthUser[keyof AuthUser] => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthUser;
    return data ? user?.[data] : user;
  },
);
