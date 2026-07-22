import { IsNumber, IsOptional, IsString } from 'class-validator';

export class IncomeRequestDto {
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsString() incomeDate?: string; // yyyy-MM-dd
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() categoryName?: string;
  @IsOptional() @IsNumber() businessId?: number;
  @IsOptional() @IsNumber() customerId?: number;
}
