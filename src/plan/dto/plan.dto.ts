import { IsNumber, IsOptional } from 'class-validator';

/** SubRequest — note the capitalized JSON keys (legacy Lombok getters). */
export class SubRequestDto {
  @IsOptional() @IsNumber() PlanId?: number;
  @IsOptional() @IsNumber() UserId?: number;
}
