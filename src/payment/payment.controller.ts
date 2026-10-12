import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { InitPaymentDto, ManualPaymentDto } from './dto/payment.dto';
import { BusinessPermission } from '../common/authz/authz.decorators';
import { Permission } from '../common/authz/permissions';

/** PaymentController — `/api/payments`. */
@Controller('payments')
export class PaymentController {
  constructor(private readonly payment: PaymentService) {}

  @BusinessPermission(Permission.WRITE, {
    resource: 'invoice',
    idBody: 'invoiceId',
  })
  @Post('paystack/initialize')
  initPaystack(@Body() dto: InitPaymentDto) {
    return this.payment.initializePaystack(dto);
  }

  @BusinessPermission(Permission.WRITE, {
    resource: 'paymentReference',
    idParam: 'reference',
  })
  @Get('verify/:reference')
  verify(@Param('reference') reference: string) {
    return this.payment.verifyPaystack(reference);
  }

  @BusinessPermission(Permission.WRITE, {
    resource: 'invoice',
    idBody: 'invoiceId',
  })
  @Post('stripe/create-intent')
  stripeIntent(@Body() dto: InitPaymentDto) {
    return this.payment.createStripeIntent(dto);
  }

  @BusinessPermission(Permission.WRITE, {
    resource: 'invoice',
    idBody: 'invoiceId',
  })
  @Post('manual')
  manual(@Body() dto: ManualPaymentDto) {
    return this.payment.recordManual(dto);
  }

  @BusinessPermission(Permission.VIEW, { param: 'businessId' })
  @Get('business/:businessId')
  byBusiness(@Param('businessId') businessId: string) {
    return this.payment.listByBusiness(BigInt(businessId));
  }
}
