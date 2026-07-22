import { Module } from '@nestjs/common';
import { BusinessController } from './business.controller';
import { BusinessService } from './business.service';
import { InvitationService } from './invitation.service';

@Module({
  controllers: [BusinessController],
  providers: [BusinessService, InvitationService],
})
export class BusinessModule {}
