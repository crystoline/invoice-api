import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/** Thin Stripe wrapper. No-ops gracefully when STRIPE_SECRET_KEY is unset. */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe | null = null;
  private readonly webhookSecret: string;

  constructor(config: ConfigService) {
    const key = config.get<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    if (key) this.stripe = new Stripe(key);
    else
      this.logger.warn('STRIPE_SECRET_KEY not set — Stripe payments disabled.');
  }

  get configured(): boolean {
    return !!this.stripe;
  }

  async createPaymentIntent(
    amountMinor: number,
    currency: string,
    metadata: Record<string, string>,
  ) {
    if (!this.stripe) return null;
    return this.stripe.paymentIntents.create({
      amount: amountMinor,
      currency: currency.toLowerCase(),
      metadata,
    });
  }

  /**
   * Hosted Checkout for a recurring subscription. The price is given inline,
   * so plans don't have to be mirrored in Stripe; Stripe bills each period
   * automatically. `metadata` is copied onto the Stripe subscription too.
   * With `trialEnd`, the card is saved now and first charged then.
   */
  async createSubscriptionCheckout(params: {
    email: string;
    productName: string;
    amountMinor: number;
    currency: string;
    interval: 'month' | 'year';
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
    trialEnd?: Date;
  }): Promise<string> {
    if (!this.stripe) throw new Error('Stripe is not configured');
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: params.email,
      client_reference_id: params.metadata.userId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: params.currency.toLowerCase(),
            unit_amount: params.amountMinor,
            recurring: { interval: params.interval },
            product_data: { name: params.productName },
          },
        },
      ],
      subscription_data: {
        metadata: params.metadata,
        ...(params.trialEnd && {
          trial_end: Math.floor(params.trialEnd.getTime() / 1000),
        }),
      },
      metadata: params.metadata,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
    if (!session.url) throw new Error('Stripe returned no checkout URL');
    return session.url;
  }

  async retrieveSubscription(id: string): Promise<Stripe.Subscription> {
    if (!this.stripe) throw new Error('Stripe is not configured');
    return this.stripe.subscriptions.retrieve(id);
  }

  /** Stop renewal (access runs to the end of the paid period) or end it now. */
  async cancelSubscription(id: string, atPeriodEnd: boolean): Promise<void> {
    if (!this.stripe) throw new Error('Stripe is not configured');
    if (atPeriodEnd) {
      await this.stripe.subscriptions.update(id, {
        cancel_at_period_end: true,
      });
    } else {
      await this.stripe.subscriptions.cancel(id);
    }
  }

  constructEvent(rawBody: Buffer, signature: string): Stripe.Event | null {
    if (!this.stripe || !this.webhookSecret) return null;
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );
  }
}
