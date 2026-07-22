import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { InvoiceScheduler } from './invoice.scheduler';

@Module({
  controllers: [InvoiceController],
  providers: [InvoiceService, InvoiceScheduler],
})
export class InvoiceModule {}
