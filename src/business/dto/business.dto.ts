import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class BusinessRequestDto {
  @IsOptional() @IsString() businessName?: string;
  @IsOptional() @IsString() businessAddress?: string;
  @IsOptional() @IsString() businessEmail?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsBoolean() isActive?: boolean; // accepted but server-controlled
}

export class BusinessSettingsDto {
  @IsOptional() @IsString() businessName?: string;
  @IsOptional() @IsString() businessAddress?: string;
  @IsOptional() @IsString() businessEmail?: string;
  @IsOptional() @IsString() businessPhone?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() defaultCurrency?: string;
  @IsOptional() @IsNumber() paymentTermsDays?: number;
  @IsOptional() @IsString() invoicePrefix?: string;
  @IsOptional() @IsNumber() invoiceStartingNumber?: number;
  @IsOptional() @IsString() paystackPublicKey?: string;
  @IsOptional() @IsString() paystackSecretKey?: string;
  @IsOptional() @IsString() stripePublicKey?: string;
  @IsOptional() @IsString() stripeSecretKey?: string;
  @IsOptional() @IsBoolean() testMode?: boolean;
}

export class InviteDto {
  @IsOptional() @IsString() email?: string;
}
