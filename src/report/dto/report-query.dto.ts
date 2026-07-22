import { IsOptional, IsString } from 'class-validator';

/**
 * Shared query DTO for every `/api/reports/*` endpoint. All fields are optional
 * strings — `businessId` is validated/guarded inside the service (so a missing
 * or malformed value returns a `fail()` envelope rather than a 400), and
 * `from`/`to` are ISO date strings. `format=csv` switches the payload to a CSV
 * string. The global ValidationPipe whitelist strips any undecorated field.
 */
export class ReportQueryDto {
  @IsOptional() @IsString() businessId?: string;
  @IsOptional() @IsString() from?: string; // ISO date (inclusive lower bound)
  @IsOptional() @IsString() to?: string; // ISO date (inclusive upper bound)
  @IsOptional() @IsString() format?: string; // 'csv' → return { csv }
  @IsOptional() @IsString() currency?: string; // ISO currency; defaults to the business default
}
