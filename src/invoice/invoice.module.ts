import { Module } from '@nestjs/common';
import { PlanLimitsModule } from '../plan-limits/plan-limits.module';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { InvoiceScheduler } from './invoice.scheduler';

@Module({
  imports: [PlanLimitsModule],
  controllers: [InvoiceController],
  providers: [InvoiceService, InvoiceScheduler],
})
export class InvoiceModule {}
