import { Controller, Post, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentService } from './payment.service';
import { Public } from '../common/decorators/public.decorator';

/**
 * WebhookController — `/api/webhooks`. Public routes verified by gateway
 * signatures over the RAW request body (main.ts enables rawBody).
 */
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly payment: PaymentService) {}

  @Public()
  @Post('paystack')
  paystack(@Req() req: RawBodyRequest<Request>) {
    const sig = String(req.headers['x-paystack-signature'] ?? '');
    return this.payment.handlePaystackWebhook(req.rawBody ?? Buffer.from(''), sig);
  }

  @Public()
  @Post('stripe')
  stripe(@Req() req: RawBodyRequest<Request>) {
    const sig = String(req.headers['stripe-signature'] ?? '');
    return this.payment.handleStripeWebhook(req.rawBody ?? Buffer.from(''), sig);
  }
}
