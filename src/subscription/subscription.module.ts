import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { PlanLimitsModule } from '../plan-limits/plan-limits.module';
import {
  PublicPlansController,
  SubscriptionController,
} from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { SubscriptionBillingService } from './subscription-billing.service';

@Module({
  imports: [PaymentModule, PlanLimitsModule], // gateways; plan usage
  controllers: [SubscriptionController, PublicPlansController],
  providers: [SubscriptionService, SubscriptionBillingService],
  // Exported so WebhookModule can route subscription events.
  exports: [SubscriptionService, SubscriptionBillingService],
})
export class SubscriptionModule {}
