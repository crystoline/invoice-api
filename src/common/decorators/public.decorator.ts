import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as public (skips JwtAuthGuard). The NestJS analog of adding a
 * path to Spring's WebSecurityConfig permitAll() allowlist.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
