import { Module } from '@nestjs/common';
import { PlanLimitsService } from './plan-limits.service';

// Its own module (Prisma only) so business, invoice, payment and subscription
// modules can all check limits without importing each other.
@Module({
  providers: [PlanLimitsService],
  exports: [PlanLimitsService],
})
export class PlanLimitsModule {}
