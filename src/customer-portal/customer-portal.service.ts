import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class CustomerPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Generate a portal token for an invoice (7-day expiry). Exported for other
   * modules (e.g. invoice send) to build a public payment link.
   */
  async createTokenForInvoice(invoiceId: bigint): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    await this.prisma.portal_tokens.create({
      data: {
        token,
        invoice_id: invoiceId,
        expires_at: new Date(Date.now() + SEVEN_DAYS_MS),
        used: false,
      },
    });
    return token;
  }

  /** Resolve + validate a portal token, returning its invoice_id or null. */
  private async resolveInvoiceId(token: string): Promise<bigint | null> {
    const row = await this.prisma.portal_tokens.findUnique({ where: { token } });
    if (!row || row.used) return null;
    if (row.expires_at && row.expires_at.getTime() < Date.now()) return null;
    return row.invoice_id ?? null;
  }

  /** Public — the customer-facing invoice view. */
  async getInvoiceView(token: string): Promise<ResponseObject> {
    const invoiceId = await this.resolveInvoiceId(token);
    if (invoiceId == null) return fail('Invalid or expired link');
    const invoice = await this.prisma.invoices.findUnique({
      where: { id: invoiceId },
      include: {
        businesses: true,
        customers: true,
        invoice_items: { include: { products: true } },
      },
    });
    if (!invoice) return fail('Invalid or expired link');
    const view = {
      invoiceNumber: invoice.invoice_number,
      total: invoice.total_amount != null ? Number(invoice.total_amount) : null,
      currency: invoice.currency_code,
      status: invoice.invoice_status,
      businessName: invoice.businesses.business_name,
      customerName: `${invoice.customers.first_name ?? ''} ${invoice.customers.last_name ?? ''}`.trim(),
      items: invoice.invoice_items.map((it) => ({
        name: it.products.name,
        quantity: it.quantity,
        unitPrice: it.products.unit_price != null ? Number(it.products.unit_price) : null,
      })),
    };
    return ok('Invoice fetched successfully', view);
  }

  /** Public — initialize a Paystack transaction for the invoice behind the token. */
  async initiatePayment(token: string): Promise<ResponseObject> {
    const invoiceId = await this.resolveInvoiceId(token);
    if (invoiceId == null) return fail('Invalid or expired link');
    const invoice = await this.prisma.invoices.findUnique({
      where: { id: invoiceId },
      include: { customers: true },
    });
    if (!invoice) return fail('Invalid or expired link');

    const secretKey = this.config.get<string>('PAYSTACK_SECRET_KEY') ?? process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) return fail('Payment is not configured');
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? process.env.FRONTEND_URL ?? 'http://localhost:3000';

    try {
      const res = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: invoice.customers.email ?? '',
          amount: Math.round(Number(invoice.total_amount) * 100),
          callback_url: `${frontendUrl}/payment/verify`,
        }),
      });
      if (!res.ok) return fail('Failed to initialize payment');
      const json = (await res.json()) as { data?: { authorization_url?: string } };
      const authorizationUrl = json.data?.authorization_url;
      if (!authorizationUrl) return fail('Failed to initialize payment');
      return ok('Payment initialized successfully', { authorizationUrl });
    } catch (e) {
      return fail(`Failed to initialize payment: ${(e as Error).message}`);
    }
  }
}
