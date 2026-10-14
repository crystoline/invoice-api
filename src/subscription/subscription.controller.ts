import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionBillingService } from './subscription-billing.service';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Authenticated } from '../common/authz/authz.decorators';
import {
  SubscribeDto,
  ChangePlanDto,
  CheckoutDto,
  CountryDto,
} from './dto/subscription.dto';

/**
 * SubscriptionController — `/api/subscription`. A subscription belongs to a
 * user (a business runs on its owner's plan); the user's billing country
 * decides which plans they see and how they pay.
 */
@Authenticated() // every route is scoped to the caller's own data
@Controller('subscription')
export class SubscriptionController {
  constructor(
    private readonly subscriptions: SubscriptionService,
    private readonly billing: SubscriptionBillingService,
  ) {}

  @Get('billing-profile')
  billingProfile(@CurrentUser() user: AuthUser) {
    return this.subscriptions.getBillingProfile(user);
  }

  @Get('payments')
  payments(@CurrentUser() user: AuthUser) {
    return this.subscriptions.getPayments(user);
  }

  @Get('plans')
  plans(@CurrentUser() user: AuthUser) {
    return this.subscriptions.getPlans(user);
  }

  @Get('current')
  current(@CurrentUser() user: AuthUser) {
    return this.subscriptions.getCurrent(user);
  }

  @Post('subscribe')
  subscribe(@Body() dto: SubscribeDto, @CurrentUser() user: AuthUser) {
    return this.subscriptions.subscribe(dto, user);
  }

  /** Hosted checkout in the user's jurisdiction: Paystack (NGN) or Stripe (USD). */
  @Post('checkout')
  checkout(@Body() dto: CheckoutDto, @CurrentUser() user: AuthUser) {
    return this.billing.checkout(dto, user);
  }

  @Post('change')
  change(@Body() dto: ChangePlanDto, @CurrentUser() user: AuthUser) {
    return this.subscriptions.changePlan(dto, user);
  }

  @Post('cancel')
  cancel(@CurrentUser() user: AuthUser) {
    return this.subscriptions.cancel(user);
  }

  @Put('country')
  setCountry(@Body() dto: CountryDto, @CurrentUser() user: AuthUser) {
    return this.subscriptions.setCountry(dto, user);
  }
}
