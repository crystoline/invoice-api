import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the given roles, enforced by RolesGuard. Equivalent to
 * the in-code role checks the Spring controllers perform (e.g. requiring
 * ROLE_SUPER_ADMIN on create-admin-user).
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
