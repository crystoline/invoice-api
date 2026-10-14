import { IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * Body for `POST /api/subscription/subscribe`. `planId` is validated as
 * optional so a missing value is reported through the ResponseObject envelope
 * (fail) rather than a raw 400 from the ValidationPipe — matching the rest of
 * the codebase.
 */
export class SubscribeDto {
  @IsOptional() @IsNumber() planId?: number;
}

/** Body for `POST /api/subscription/change` (upgrade / downgrade). */
export class ChangePlanDto {
  @IsOptional() @IsNumber() planId?: number;
}

/** Body for `POST /api/subscription/checkout`. */
export class CheckoutDto {
  @IsOptional() @IsNumber() planId?: number;
  /** MONTHLY | YEARLY (case-insensitive). */
  @IsOptional() @IsString() interval?: string;
}

/** Body for `PUT /api/subscription/country` — ISO 3166-1 alpha-2, e.g. "NG". */
export class CountryDto {
  @IsOptional() @IsString() country?: string;
}
