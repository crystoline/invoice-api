import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

export class BillItemDto {
  @IsOptional() @IsNumber() price?: number;
  @IsOptional() @IsNumber() quantity?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() productId?: number;
}

export class BillRequestDto {
  @IsOptional() @IsNumber() totalAmount?: number;
  @IsOptional() @IsString() billNumber?: string;
  @IsOptional() @IsBoolean() isPaid?: boolean;
  @IsOptional() @IsNumber() businessId?: number;
  @IsOptional() @IsNumber() vendorId?: number;
  @IsOptional() @IsNumber() VendorIdOrUserId?: number; // legacy — ignored
  @IsOptional() @IsNumber() billedUserId?: number; // legacy — ignored (derived from the current user)
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => BillItemDto) items?: BillItemDto[];
}
