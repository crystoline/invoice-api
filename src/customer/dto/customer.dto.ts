import { IsOptional, IsString } from 'class-validator';

export class CustomerRequestDto {
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() address?: string;
}
