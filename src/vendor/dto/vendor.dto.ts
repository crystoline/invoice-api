import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class VendorRequestDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsBoolean() status?: boolean;
}

export class VendorProductRequestDto {
  @IsOptional() @IsString() vendorProductName?: string;
  @IsOptional() @IsNumber() vendorProductPrice?: number;
  @IsOptional() @IsBoolean() vendorProductStatus?: boolean;
  @IsOptional() @IsNumber() vendorId?: number; // unused by service (vendor from path)
}
