import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const API = 'https://api.paystack.co';

/** A Paystack subscription as returned by GET /subscription. */
export interface PaystackSubscription {
  subscription_code: string;
  email_token: string;
  status: string;
  next_payment_date?: string | null;
  plan?: { plan_code?: string };
}

/**
 * Paystack API wrapper (platform account — PAYSTACK_SECRET_KEY). Used for the
 * legacy one-off transaction initialization and for subscription billing:
 * plans, subscription checkout and cancellation.
 */
@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);

  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return !!this.config.get<string>('PAYSTACK_SECRET_KEY');
  }

  /** Call the Paystack API; returns `data` from the envelope, throws on failure. */
  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const secretKey = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secretKey) throw new Error('Paystack is not configured');
    const res = await fetch(`${API}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: T;
    };
    if (!res.ok || !json.status) {
      throw new Error(`Paystack ${path}: ${json.message ?? res.statusText}`);
    }
    return json.data as T;
  }

  async initializePayment(
    userEmail: string,
    amount: number,
  ): Promise<string | null> {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    try {
      const data = await this.request<{ authorization_url?: string }>(
        '/transaction/initialize',
        {
          method: 'POST',
          body: {
            email: userEmail,
            amount: amount * 100, // Naira → kobo
            callback_url: `${frontendUrl}/payment/verify`,
          },
        },
      );
      return data.authorization_url ?? null;
    } catch (e) {
      this.logger.error(`Paystack init failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** Create a recurring plan; returns its plan_code. `amountMinor` is in kobo. */
  async createPlan(params: {
    name: string;
    amountMinor: number;
    interval: 'monthly' | 'annually';
    currency: string;
  }): Promise<string> {
    const data = await this.request<{ plan_code: string }>('/plan', {
      method: 'POST',
      body: {
        name: params.name,
        amount: params.amountMinor,
        interval: params.interval,
        currency: params.currency,
      },
    });
    return data.plan_code;
  }

  /**
   * Start a subscription checkout: the first charge is taken now and Paystack
   * then bills the plan automatically. Returns the hosted checkout URL.
   */
  async initializeSubscription(params: {
    email: string;
    planCode: string;
    amountMinor: number;
    currency: string;
    callbackUrl: string;
    metadata: Record<string, string>;
  }): Promise<string> {
    const data = await this.request<{ authorization_url: string }>(
      '/transaction/initialize',
      {
        method: 'POST',
        body: {
          email: params.email,
          amount: params.amountMinor, // overridden by the plan's amount
          plan: params.planCode,
          currency: params.currency,
          callback_url: params.callbackUrl,
          metadata: params.metadata,
        },
      },
    );
    return data.authorization_url;
  }

  /** Subscriptions of a customer (id or code), optionally for one plan code. */
  async listSubscriptions(customer: string): Promise<PaystackSubscription[]> {
    return this.request<PaystackSubscription[]>(
      `/subscription?customer=${encodeURIComponent(customer)}`,
    );
  }

  /** Stop future charges. Access already paid for is unaffected. */
  async disableSubscription(code: string, token: string): Promise<void> {
    await this.request('/subscription/disable', {
      method: 'POST',
      body: { code, token },
    });
  }
}
