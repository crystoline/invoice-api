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
    else this.logger.warn('STRIPE_SECRET_KEY not set — Stripe payments disabled.');
  }

  get configured(): boolean {
    return !!this.stripe;
  }

  async createPaymentIntent(amountMinor: number, currency: string, metadata: Record<string, string>) {
    if (!this.stripe) return null;
    return this.stripe.paymentIntents.create({ amount: amountMinor, currency: currency.toLowerCase(), metadata });
  }

  constructEvent(rawBody: Buffer, signature: string): Stripe.Event | null {
    if (!this.stripe || !this.webhookSecret) return null;
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }
}
