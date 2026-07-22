import { Module } from '@nestjs/common';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';

@Module({
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
  // Exported so other modules (e.g. invoice creation) can call checkInvoiceQuota().
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
