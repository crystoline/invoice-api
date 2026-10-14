import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * Request DTOs for the platform AdminModule. Style mirrors the existing
 * feature DTOs (e.g. ExpenseCategoryRequestDto) — plain class-validator,
 * camelCase in / snake_case mapped in the service.
 */

const ROLE_NAMES = [
  'ROLE_ADMIN',
  'ROLE_USER',
  'ROLE_SUPER_ADMIN',
  'BUSINESS_USER',
];

export class AdminCreateUserDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsEmail() email!: string;
  @IsString() password!: string;
  @IsOptional() @IsIn(ROLE_NAMES) role?: string;
}

export class UpdateUserStatusDto {
  @IsBoolean() active!: boolean;
}

export class UpdateUserRoleDto {
  @IsIn(ROLE_NAMES) role!: string;
}

export class BusinessStatusDto {
  @IsBoolean() active!: boolean;
}

export class PlanRequestDto {
  /** NG (naira, Paystack) | OTHER (USD, Stripe). Required on create; fixes the currency. */
  @IsOptional() @IsString() jurisdiction?: string;
  @IsOptional() @IsNumber() priceMonthly?: number;
  @IsOptional() @IsNumber() priceYearly?: number;
  /** Optional: links equivalent plans across jurisdictions (e.g. "basic"). */
  @IsOptional() @IsString() tier?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsString() description?: string;
  // Legacy dual-currency prices — ignored (a plan has one currency now).
  @IsOptional() @IsNumber() priceNgnMonthly?: number;
  @IsOptional() @IsNumber() priceNgnYearly?: number;
  @IsOptional() @IsNumber() priceUsdMonthly?: number;
  @IsOptional() @IsNumber() priceUsdYearly?: number;
  @IsOptional() @IsNumber() maxInvoicesPerMonth?: number | null;
  @IsOptional() @IsNumber() maxBusinesses?: number | null;
  @IsOptional() @IsNumber() maxTeamMembers?: number | null;
  @IsOptional() @IsBoolean() allowPaymentCollection?: boolean;
  @IsOptional() @IsBoolean() allowRecurringInvoices?: boolean;
  @IsOptional() @IsBoolean() allowCustomTemplates?: boolean;
  @IsOptional() @IsBoolean() allowApiAccess?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsNumber() durationInDays?: number;
}

export class UserCountryDto {
  /** ISO 3166-1 alpha-2, e.g. "NG". */
  @IsOptional() @IsString() country?: string;
}

export class PlanActiveDto {
  @IsBoolean() active!: boolean;
}

export class CategoryRequestDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
}
