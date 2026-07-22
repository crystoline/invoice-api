import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class ProductRequestDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() unitPrice?: number;
  @IsOptional() @IsBoolean() isProductActive?: boolean;
  @IsOptional() @IsNumber() categoryId?: number;
}

export class CategoryRequestDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
}
