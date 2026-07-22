import { Module } from '@nestjs/common';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';
import { PaystackService } from '../payment/paystack.service';

@Module({
  controllers: [PlanController],
  providers: [PlanService, PaystackService],
})
export class PlanModule {}
