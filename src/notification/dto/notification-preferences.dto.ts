import { IsBoolean, IsOptional } from 'class-validator';

export class NotificationPreferencesDto {
  @IsOptional() @IsBoolean() invoiceSent?: boolean;
  @IsOptional() @IsBoolean() paymentReceived?: boolean;
  @IsOptional() @IsBoolean() invoiceOverdue?: boolean;
  @IsOptional() @IsBoolean() billReminder?: boolean;
}
