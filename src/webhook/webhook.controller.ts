import {
  Controller,
  Logger,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { PaymentService } from '../payment/payment.service';
import {
  PaystackEvent,
  SubscriptionBillingService,
} from '../subscription/subscription-billing.service';

/**
 * Payment gateway webhooks — `/api/webhooks/*`. Public (gateways can't log
 * in) but every request must carry a valid signature. Each verified event is
 * offered to both consumers: invoice payments and platform subscriptions; each
 * ignores what isn't theirs. Handler errors are logged, never echoed back.
 */
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly payments: PaymentService,
    private readonly subscriptions: SubscriptionBillingService,
  ) {}

  @Public()
  @Post('paystack')
  async paystack(@Req() req: RawBodyRequest<Request>) {
    const raw = req.rawBody ?? Buffer.from('');
    const sig = String(req.headers['x-paystack-signature'] ?? '');
    if (!this.payments.verifyPaystackSignature(raw, sig)) {
      return { received: false };
    }
    let event: PaystackEvent;
    try {
      event = JSON.parse(raw.toString('utf8')) as PaystackEvent;
    } catch {
      return { received: false };
    }
    await this.payments.handlePaystackEvent(event);
    await this.subscriptions
      .handlePaystackEvent(event)
      .catch((e: Error) => this.log('Paystack', event.event, e));
    return { received: true };
  }

  @Public()
  @Post('stripe')
  async stripe(@Req() req: RawBodyRequest<Request>) {
    const raw = req.rawBody ?? Buffer.from('');
    const sig = String(req.headers['stripe-signature'] ?? '');
    const event = this.payments.constructStripeEvent(raw, sig);
    if (!event) return { received: false };
    await this.payments.handleStripeEvent(event);
    await this.subscriptions
      .handleStripeEvent(event)
      .catch((e: Error) => this.log('Stripe', event.type, e));
    return { received: true };
  }

  private log(gateway: string, type: string | undefined, e: Error) {
    this.logger.error(`${gateway} ${type ?? '?'} failed: ${e.message}`);
  }
}
