import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/** Flips past-due unpaid invoices to 'overdue' once a day. */
@Injectable()
export class InvoiceScheduler {
  private readonly logger = new Logger(InvoiceScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async markOverdue(): Promise<void> {
    const res = await this.prisma.invoices.updateMany({
      where: {
        is_paid: { not: true },
        due_date: { lt: new Date() },
        invoice_status: { notIn: ['paid', 'overdue', 'cancelled'] },
      },
      data: { invoice_status: 'overdue' },
    });
    if (res.count) this.logger.log(`Marked ${res.count} invoices overdue`);
  }
}
