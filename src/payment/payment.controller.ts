import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { InitPaymentDto, ManualPaymentDto } from './dto/payment.dto';

/** PaymentController — `/api/payments`. */
@Controller('payments')
export class PaymentController {
  constructor(private readonly payment: PaymentService) {}

  @Post('paystack/initialize')
  initPaystack(@Body() dto: InitPaymentDto, @CurrentUser() user: AuthUser) {
    return this.payment.initializePaystack(dto, user);
  }

  @Get('verify/:reference')
  verify(@Param('reference') reference: string) {
    return this.payment.verifyPaystack(reference);
  }

  @Post('stripe/create-intent')
  stripeIntent(@Body() dto: InitPaymentDto, @CurrentUser() user: AuthUser) {
    return this.payment.createStripeIntent(dto, user);
  }

  @Post('manual')
  manual(@Body() dto: ManualPaymentDto, @CurrentUser() user: AuthUser) {
    return this.payment.recordManual(dto, user);
  }

  @Get('business/:businessId')
  byBusiness(@Param('businessId') businessId: string) {
    return this.payment.listByBusiness(BigInt(businessId));
  }
}
