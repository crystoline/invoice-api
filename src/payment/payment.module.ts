import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { WebhookController } from './webhook.controller';
import { PaymentService } from './payment.service';
import { StripeService } from './stripe.service';

@Module({
  controllers: [PaymentController, WebhookController],
  providers: [PaymentService, StripeService],
})
export class PaymentModule {}
