import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateTaxRateDto {
  @IsOptional() @IsNumber() businessId?: number;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() rate?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateTaxRateDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() rate?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
