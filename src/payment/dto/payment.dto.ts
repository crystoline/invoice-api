import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export class InitPaymentDto {
  @IsOptional() @IsNumber() invoiceId?: number;
}

export class ManualPaymentDto {
  @IsOptional() @IsNumber() invoiceId?: number;
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsIn(['MANUAL', 'PAYSTACK', 'STRIPE', 'PAYPAL', 'CASH', 'TRANSFER']) method?: string;
  @IsOptional() @IsString() reference?: string;
}
