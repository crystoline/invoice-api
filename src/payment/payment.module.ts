import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PaystackService } from './paystack.service';
import { StripeService } from './stripe.service';

// Webhooks live in WebhookModule, which routes each event to invoice payments
// (PaymentService) and subscriptions (SubscriptionBillingService).
@Module({
  controllers: [PaymentController],
  providers: [PaymentService, StripeService, PaystackService],
  exports: [PaymentService, StripeService, PaystackService],
})
export class PaymentModule {}
