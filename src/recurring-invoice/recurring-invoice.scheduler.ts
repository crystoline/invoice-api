import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RecurringInvoiceService } from './recurring-invoice.service';

/** Runs the recurring-invoice generator daily (replaces the Spring stub). */
@Injectable()
export class RecurringInvoiceScheduler {
  private readonly logger = new Logger(RecurringInvoiceScheduler.name);

  constructor(private readonly service: RecurringInvoiceService) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async handleCron(): Promise<void> {
    this.logger.log('Running daily recurring-invoice generation');
    await this.service.generateDue();
  }
}
