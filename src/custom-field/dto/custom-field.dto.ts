import { IsOptional, IsString } from 'class-validator';

/** All fields are labels/config strings (mirrors InvoiceConfigModuleRequest). */
export class InvoiceConfigRequestDto {
  @IsOptional() @IsString() customName?: string;
  @IsOptional() @IsString() customer?: string;
  @IsOptional() @IsString() invoiceNumber?: string;
  @IsOptional() @IsString() totalAmount?: string;
  @IsOptional() @IsString() invoiceDate?: string;
  @IsOptional() @IsString() isRecurring?: string;
  @IsOptional() @IsString() frequency?: string;
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsString() price?: string;
  @IsOptional() @IsString() quantity?: string;
}
