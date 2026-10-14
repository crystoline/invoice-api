import { Module } from '@nestjs/common';
import { PlanLimitsModule } from '../plan-limits/plan-limits.module';
import { RecurringInvoiceController } from './recurring-invoice.controller';
import { RecurringInvoiceService } from './recurring-invoice.service';
import { RecurringInvoiceScheduler } from './recurring-invoice.scheduler';

@Module({
  imports: [PlanLimitsModule],
  controllers: [RecurringInvoiceController],
  providers: [RecurringInvoiceService, RecurringInvoiceScheduler],
})
export class RecurringInvoiceModule {}
