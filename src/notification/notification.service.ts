import { Injectable } from '@nestjs/common';
import { notification_preferences } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { NotificationPreferencesDto } from './dto/notification-preferences.dto';

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  private mapDTO(p: notification_preferences) {
    return {
      invoiceSent: p.invoice_sent,
      paymentReceived: p.payment_received,
      invoiceOverdue: p.invoice_overdue,
      billReminder: p.bill_reminder,
    };
  }

  /** GET — current user's prefs; create all-true defaults on first access. */
  async getForUser(userId: bigint): Promise<ResponseObject> {
    try {
      let prefs = await this.prisma.notification_preferences.findUnique({ where: { user_id: userId } });
      if (!prefs) {
        prefs = await this.prisma.notification_preferences.create({
          data: {
            user_id: userId,
            invoice_sent: true,
            payment_received: true,
            invoice_overdue: true,
            bill_reminder: true,
          },
        });
      }
      return ok('Notification preferences fetched successfully', this.mapDTO(prefs));
    } catch (e) {
      return fail(`Failed to fetch notification preferences: ${(e as Error).message}`);
    }
  }

  /** PUT — upsert by user_id. */
  async update(userId: bigint, dto: NotificationPreferencesDto): Promise<ResponseObject> {
    try {
      const prefs = await this.prisma.notification_preferences.upsert({
        where: { user_id: userId },
        update: {
          invoice_sent: dto.invoiceSent ?? undefined,
          payment_received: dto.paymentReceived ?? undefined,
          invoice_overdue: dto.invoiceOverdue ?? undefined,
          bill_reminder: dto.billReminder ?? undefined,
        },
        create: {
          user_id: userId,
          invoice_sent: dto.invoiceSent ?? true,
          payment_received: dto.paymentReceived ?? true,
          invoice_overdue: dto.invoiceOverdue ?? true,
          bill_reminder: dto.billReminder ?? true,
        },
      });
      return ok('Notification preferences updated successfully', this.mapDTO(prefs));
    } catch (e) {
      return fail(`Failed to update notification preferences: ${(e as Error).message}`);
    }
  }
}
