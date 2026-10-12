import { Role } from '../enums/role.enum';
import { AuthUser } from '../decorators/current-user.decorator';

/**
 * A user's role inside one business. OWNER is implicit (businesses.owner_id);
 * the others are stored on business_members.role.
 */
export enum BusinessRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
}

/** Roles an owner/admin may give a member (ownership is never assignable). */
export const ASSIGNABLE_ROLES: readonly BusinessRole[] = [
  BusinessRole.ADMIN,
  BusinessRole.MEMBER,
  BusinessRole.VIEWER,
];

/** What a route needs to be allowed to do inside a business. */
export enum Permission {
  /** Read anything in the business: invoices, customers, reports, … */
  VIEW = 'VIEW',
  /** Create/edit records; send invoices; record payments; mark bills paid. */
  WRITE = 'WRITE',
  /** Approve or reject invoices (the checker step of maker-checker). */
  APPROVE = 'APPROVE',
  /** Delete records. */
  DELETE = 'DELETE',
  /** Business profile, settings, logo, payment keys, tax rates. */
  MANAGE_SETTINGS = 'MANAGE_SETTINGS',
  /** Invite and remove members, change their roles. */
  MANAGE_MEMBERS = 'MANAGE_MEMBERS',
  /** Delete the business itself. */
  DELETE_BUSINESS = 'DELETE_BUSINESS',
}

const ALL = Object.values(Permission);

/** The single source of truth for who may do what. */
export const ROLE_PERMISSIONS: Readonly<
  Record<BusinessRole, readonly Permission[]>
> = {
  [BusinessRole.OWNER]: ALL,
  [BusinessRole.ADMIN]: ALL.filter((p) => p !== Permission.DELETE_BUSINESS),
  [BusinessRole.MEMBER]: [Permission.VIEW, Permission.WRITE],
  [BusinessRole.VIEWER]: [Permission.VIEW],
};

export const roleCan = (role: BusinessRole, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission);

/** Stored role string → BusinessRole; anything unrecognised gets least privilege. */
export const toBusinessRole = (
  value: string | null | undefined,
): BusinessRole =>
  (Object.values(BusinessRole) as string[]).includes(value ?? '') &&
  value !== BusinessRole.OWNER
    ? (value as BusinessRole)
    : BusinessRole.VIEWER;

const PLATFORM_ADMIN_ROLES: readonly string[] = [Role.ADMIN, Role.SUPER_ADMIN];

/** Platform staff (ROLE_ADMIN / ROLE_SUPER_ADMIN) can act in any business. */
export const isPlatformAdmin = (user: AuthUser | null | undefined): boolean =>
  !!user?.roles?.some((r) => PLATFORM_ADMIN_ROLES.includes(r));

const PERMISSION_PHRASE: Record<Permission, string> = {
  [Permission.VIEW]: 'view this business',
  [Permission.WRITE]: 'create or change records',
  [Permission.APPROVE]: 'approve invoices',
  [Permission.DELETE]: 'delete records',
  [Permission.MANAGE_SETTINGS]: 'change business settings',
  [Permission.MANAGE_MEMBERS]: 'manage members',
  [Permission.DELETE_BUSINESS]: 'delete the business',
};

export const deniedMessage = (role: BusinessRole, permission: Permission) =>
  `Your role in this business (${role.toLowerCase()}) does not allow you to ${PERMISSION_PHRASE[permission]}.`;
