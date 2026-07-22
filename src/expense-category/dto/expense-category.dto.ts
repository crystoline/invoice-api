import { IsNumber, IsOptional, IsString } from 'class-validator';

export class ExpenseCategoryRequestDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsNumber() businessId?: number;
}
