import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One bill line. Free text — `productId` is an optional catalogue link. */
export class BillItemDto {
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsInt() @Min(0) quantity?: number; // bill_items.quantity is INT
  @IsOptional() @IsString() @MaxLength(255) description?: string;
  @IsOptional() @IsNumber() productId?: number;
}

export class BillRequestDto {
  /** Ignored when `items` has lines — the total is then the sum of the lines. */
  @IsOptional() @IsNumber() totalAmount?: number;
  @IsOptional() @IsString() billNumber?: string;
  @IsOptional() @IsBoolean() isPaid?: boolean;
  @IsOptional() @IsNumber() businessId?: number;
  @IsOptional() @IsNumber() vendorId?: number;
  @IsOptional() @IsNumber() VendorIdOrUserId?: number; // legacy — ignored
  @IsOptional() @IsNumber() billedUserId?: number; // legacy — ignored (derived from the current user)
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BillItemDto)
  items?: BillItemDto[];
}
