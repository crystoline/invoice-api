import { Controller, Get, Param, Post } from '@nestjs/common';
import { CustomerPortalService } from './customer-portal.service';
import { Public } from '../common/decorators/public.decorator';

/** CustomerPortalController — public routes at `/api/public/portal/**`. */
@Controller('public/portal')
export class CustomerPortalController {
  constructor(private readonly service: CustomerPortalService) {}

  @Public()
  @Get('invoice/:token')
  view(@Param('token') token: string) {
    return this.service.getInvoiceView(token);
  }

  @Public()
  @Post('pay/:token')
  pay(@Param('token') token: string) {
    return this.service.initiatePayment(token);
  }
}
