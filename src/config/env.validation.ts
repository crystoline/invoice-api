import { plainToInstance } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, validateSync } from 'class-validator';

/**
 * Runtime validation of environment variables. Mirrors the settings the Spring
 * backend read from application.properties / .env. Optional fields are the
 * integrations that are config-only today (Stripe, PayPal) or not always set.
 */
export class EnvironmentVariables {
  @IsIn(['development', 'production', 'test'])
  @IsOptional()
  NODE_ENV: string = 'development';

  @IsNumber()
  @IsOptional()
  APP_PORT: number = 8080;

  @IsString()
  @IsOptional()
  APP_BASE_URL: string = 'http://localhost:8080';

  @IsString()
  @IsOptional()
  FRONTEND_URL: string = 'http://localhost:3000';

  // Prisma connection string, e.g. mysql://user:pass@host:3306/neutroninvdb
  @IsString()
  DATABASE_URL: string;

  // Auth
  @IsString()
  @IsOptional()
  JWT_SECRET: string;

  @IsNumber()
  @IsOptional()
  JWT_EXPIRATION_MS: number = 7200000; // 2h — matches Spring's hardcoded TTL

  @IsString()
  @IsOptional()
  GOOGLE_CLIENT_ID: string;

  @IsString()
  @IsOptional()
  GOOGLE_CLIENT_SECRET: string;

  // File uploads
  @IsString()
  @IsOptional()
  UPLOAD_DIR: string = 'uploads';
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors
        .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
        .join('\n')}`,
    );
  }
  return validated;
}
