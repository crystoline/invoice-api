import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { WebhookController } from './webhook.controller';

/** Gateway webhooks, routed to invoice payments and subscriptions. */
@Module({
  imports: [PaymentModule, SubscriptionModule],
  controllers: [WebhookController],
})
export class WebhookModule {}
