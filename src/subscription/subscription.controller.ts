import { Body, Controller, Get, Post } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { SubscribeDto, ChangePlanDto } from './dto/subscription.dto';

/** SubscriptionController — `/api/subscription`. */
@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  @Get('plans')
  plans() {
    return this.subscriptions.getPlans();
  }

  @Get('current')
  current(@CurrentUser() user: AuthUser) {
    return this.subscriptions.getCurrent(user);
  }

  @Post('subscribe')
  subscribe(@Body() dto: SubscribeDto, @CurrentUser() user: AuthUser) {
    return this.subscriptions.subscribe(dto, user);
  }

  @Post('change')
  change(@Body() dto: ChangePlanDto, @CurrentUser() user: AuthUser) {
    return this.subscriptions.changePlan(dto, user);
  }

  @Post('cancel')
  cancel(@CurrentUser() user: AuthUser) {
    return this.subscriptions.cancel(user);
  }
}
