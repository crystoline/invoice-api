/**
 * Mirrors the Spring `EnumRole`. Values are the exact role strings stored in
 * the `roles` table and embedded in JWT authorities, so they must match the
 * backend byte-for-byte.
 */
export enum Role {
  USER = 'ROLE_USER',
  BUSINESS_USER = 'BUSINESS_USER',
  ADMIN = 'ROLE_ADMIN',
  SUPER_ADMIN = 'ROLE_SUPER_ADMIN',
}
