import { SetMetadata } from '@nestjs/common';
import { Permission } from './permissions';

export const AUTHENTICATED_KEY = 'authz:authenticated';
export const BUSINESS_POLICY_KEY = 'authz:business';

/**
 * Any signed-in user may call this route. Use ONLY for routes that act on the
 * caller's own data (profile, 2FA, their subscription, creating their own
 * business, …) — never for routes that take another user's or business's id.
 */
export const Authenticated = () => SetMetadata(AUTHENTICATED_KEY, true);

/** Records the guard can trace back to the business that owns them. */
export type ResourceKind =
  | 'invoice'
  | 'bill'
  | 'customer'
  | 'product'
  | 'income'
  | 'expenseCategory'
  | 'taxRate'
  | 'vendor'
  | 'vendorProduct'
  | 'recurringInvoice'
  | 'paymentReference';

/**
 * Where the route's business comes from. Either name the business directly
 * (`param` / `query` / `body`), or name the record the route acts on
 * (`resource` + `idParam` / `idBody`) and the guard looks up its business.
 * When both are given — or the body carries a `businessId` — they must agree,
 * so a record can't be reached through a business it doesn't belong to.
 */
export interface BusinessScope {
  param?: string;
  query?: string;
  body?: string;
  resource?: ResourceKind;
  idParam?: string;
  idBody?: string;
}

export interface BusinessPolicy {
  permission: Permission;
  scope: BusinessScope;
}

/** The caller must belong to the business and their role must grant `permission`. */
export const BusinessPermission = (
  permission: Permission,
  scope: BusinessScope,
) =>
  SetMetadata(BUSINESS_POLICY_KEY, {
    permission,
    scope,
  } satisfies BusinessPolicy);
