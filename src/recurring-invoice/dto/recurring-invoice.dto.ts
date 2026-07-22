import { IsBoolean, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

const FREQ = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'];

export class CreateRecurringInvoiceDto {
  @IsOptional() @IsNumber() templateInvoiceId?: number;
  @IsOptional() @IsNumber() businessId?: number;
  @IsOptional() @IsIn(FREQ) frequency?: string;
  @IsOptional() @IsString() startDate?: string; // yyyy-MM-dd
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsNumber() dayOfMonth?: number;
  @IsOptional() @IsBoolean() autoSend?: boolean;
  @IsOptional() @IsNumber() maxOccurrences?: number;
}

export class UpdateRecurringInvoiceDto {
  @IsOptional() @IsIn(FREQ) frequency?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsNumber() dayOfMonth?: number;
  @IsOptional() @IsBoolean() autoSend?: boolean;
  @IsOptional() @IsNumber() maxOccurrences?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
