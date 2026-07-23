import { Transform } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export class InitPaymentDto {
  @IsOptional() @IsNumber() invoiceId?: number;
}

// Payment methods, canonically uppercase. Gateway values (PAYSTACK/STRIPE/…)
// come from the webhook flows; the rest are the manual methods the invoice UI
// offers (Cash / Bank transfer / Card / Cheque). The frontend sends them
// lowercase, so normalise before @IsIn — otherwise every manual payment 400s.
export const PAYMENT_METHODS = [
  'MANUAL',
  'PAYSTACK',
  'STRIPE',
  'PAYPAL',
  'CASH',
  'TRANSFER',
  'BANK_TRANSFER',
  'CARD',
  'CHEQUE',
] as const;

export class ManualPaymentDto {
  @IsOptional() @IsNumber() invoiceId?: number;
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsIn(PAYMENT_METHODS)
  method?: string;
  @IsOptional() @IsString() reference?: string;
}
