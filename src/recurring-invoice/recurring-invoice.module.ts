import { Module } from '@nestjs/common';
import { RecurringInvoiceController } from './recurring-invoice.controller';
import { RecurringInvoiceService } from './recurring-invoice.service';
import { RecurringInvoiceScheduler } from './recurring-invoice.scheduler';

@Module({
  controllers: [RecurringInvoiceController],
  providers: [RecurringInvoiceService, RecurringInvoiceScheduler],
})
export class RecurringInvoiceModule {}
