import { IsNumber, IsOptional } from 'class-validator';

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
