import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Upper bound for the free-text notes / additional-info blocks. */
export const INVOICE_TEXT_MAX = 2000;

export class InvoiceItemProductDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() unitPrice?: number;
  @IsOptional() @IsBoolean() isProductActive?: boolean;
  @IsOptional() @IsNumber() categoryId?: number;
}

export class InvoiceItemRequestDto {
  @IsOptional() @IsNumber() productId?: number;
  @IsOptional() @IsNumber() unitPrice?: number; // reprice trigger when productId set
  @IsOptional()
  @ValidateNested()
  @Type(() => InvoiceItemProductDto)
  product?: InvoiceItemProductDto;
  @IsOptional() @IsNumber() discount?: number; // whole-number percent 0..100
  @IsOptional() @IsNumber() quantity?: number;
}

export class InvoiceRequestDto {
  @IsOptional() @IsNumber() businessId?: number;
  @IsOptional() @IsNumber() customerId?: number;
  @IsOptional() @IsDateString() invoiceDate?: string;
  /** "YYYY-MM-DD"; null clears it on update. Must not precede invoiceDate. */
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsString() @MaxLength(INVOICE_TEXT_MAX) notes?: string | null;
  @IsOptional()
  @IsString()
  @MaxLength(INVOICE_TEXT_MAX)
  additionalInfo?: string | null;
  @IsOptional() @IsBoolean() isRecurring?: boolean;
  @IsOptional() @IsBoolean() recurring?: boolean; // Jackson key alias
  @IsOptional() @IsString() frequency?: string;
  @IsOptional() @IsString() currencyCode?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemRequestDto)
  items?: InvoiceItemRequestDto[];
}

export class InvoiceApprovalDto {
  @IsOptional() @IsString() approvalStatus?: string;
  @IsOptional() @IsNumber() invoiceId?: number;
}
