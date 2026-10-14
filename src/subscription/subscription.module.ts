import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { SubscriptionBillingService } from './subscription-billing.service';

@Module({
  imports: [PaymentModule], // Paystack + Stripe gateways
  controllers: [SubscriptionController],
  providers: [SubscriptionService, SubscriptionBillingService],
  // Exported so other modules can call checkInvoiceQuota() / route webhooks.
  exports: [SubscriptionService, SubscriptionBillingService],
})
export class SubscriptionModule {}
