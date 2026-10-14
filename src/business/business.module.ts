import { Module } from '@nestjs/common';
import { PlanLimitsModule } from '../plan-limits/plan-limits.module';
import { BusinessController } from './business.controller';
import { BusinessService } from './business.service';
import { InvitationService } from './invitation.service';

@Module({
  imports: [PlanLimitsModule],
  controllers: [BusinessController],
  providers: [BusinessService, InvitationService],
})
export class BusinessModule {}
