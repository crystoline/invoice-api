import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Paystack transaction initialization — port of PaystackService.
 * Returns the `authorization_url` or null on any failure. All config from env.
 */
@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);

  constructor(private readonly config: ConfigService) {}

  async initializePayment(userEmail: string, amount: number): Promise<string | null> {
    const secretKey = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secretKey) return null;
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    try {
      const res = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          amount: amount * 100, // Naira → kobo
          callback_url: `${frontendUrl}/payment/verify`,
        }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: { authorization_url?: string } };
      return json.data?.authorization_url ?? null;
    } catch (e) {
      this.logger.error(`Paystack init failed: ${(e as Error).message}`);
      return null;
    }
  }
}
