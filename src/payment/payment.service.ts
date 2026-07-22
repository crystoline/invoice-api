import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { InitPaymentDto, ManualPaymentDto } from './dto/payment.dto';

const n = (d: Prisma.Decimal | null): number => (d != null ? Number(d) : 0);

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly stripe: StripeService,
  ) {}

  private isAdmin(user: AuthUser): boolean {
    return user.roles.includes(Role.ADMIN);
  }

  /** Mark an invoice paid (or partially) and upsert a SUCCESS payment record. */
  private async recordSuccess(invoiceId: bigint, amount: number, method: string, ref: string | null) {
    const invoice = await this.prisma.invoices.findUnique({ where: { id: invoiceId } });
    if (!invoice) return;
    const paid = n(invoice.amount_paid) + amount;
    const fullyPaid = paid >= n(invoice.total_amount);
    await this.prisma.invoices.update({
      where: { id: invoiceId },
      data: {
        amount_paid: paid,
        is_paid: fullyPaid,
        paid_date: fullyPaid ? new Date() : invoice.paid_date,
        invoice_status: fullyPaid ? 'paid' : invoice.invoice_status,
      },
    });
    // Update a matching PENDING row if present, else insert.
    const pending = ref
      ? await this.prisma.payments.findFirst({ where: { transaction_ref: ref, status: 'PENDING' } })
      : null;
    if (pending) {
      await this.prisma.payments.update({ where: { id: pending.id }, data: { status: 'SUCCESS', paid_at: new Date() } });
    } else {
      await this.prisma.payments.create({
        data: {
          invoice_id: invoiceId,
          business_id: invoice.business_id,
          amount,
          currency: invoice.currency_code,
          method,
          transaction_ref: ref,
          status: 'SUCCESS',
          paid_at: new Date(),
        },
      });
    }
  }

  // POST /api/payments/paystack/initialize
  async initializePaystack(dto: InitPaymentDto, user: AuthUser): Promise<ResponseObject> {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!key) return fail('Paystack is not configured');
    const invoice = await this.prisma.invoices.findUnique({
      where: { id: BigInt(dto.invoiceId ?? 0) },
      include: { customers: true, businesses: true },
    });
    if (!invoice) return fail('Invoice not found');
    if (invoice.businesses.owner_id !== user.id && !this.isAdmin(user)) return fail('Access denied');
    try {
      const frontend = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
      const res = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: invoice.customers.email ?? '',
          amount: Math.round(n(invoice.total_amount) * 100),
          callback_url: `${frontend}/payment/verify`,
        }),
      });
      const json = (await res.json()) as { data?: { authorization_url?: string; reference?: string } };
      const url = json.data?.authorization_url;
      const reference = json.data?.reference ?? null;
      if (!url) return fail('Failed to initialize payment');
      await this.prisma.payments.create({
        data: {
          invoice_id: invoice.id,
          business_id: invoice.business_id,
          amount: n(invoice.total_amount),
          currency: invoice.currency_code,
          method: 'PAYSTACK',
          transaction_ref: reference,
          status: 'PENDING',
        },
      });
      return ok('Payment initialized', { authorizationUrl: url, reference });
    } catch (e) {
      return fail(`Failed to initialize payment: ${(e as Error).message}`);
    }
  }

  // GET /api/payments/verify/:reference
  async verifyPaystack(reference: string): Promise<ResponseObject> {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!key) return fail('Paystack is not configured');
    try {
      const res = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const json = (await res.json()) as { data?: { status?: string; amount?: number } };
      if (json.data?.status !== 'success') return fail('Payment not successful');
      const payment = await this.prisma.payments.findFirst({ where: { transaction_ref: reference } });
      if (payment?.invoice_id) {
        await this.recordSuccess(payment.invoice_id, (json.data.amount ?? 0) / 100, 'PAYSTACK', reference);
      }
      return ok('Payment verified', { reference });
    } catch (e) {
      return fail(`Verification failed: ${(e as Error).message}`);
    }
  }

  // POST /api/webhooks/paystack — verify HMAC-SHA512 of the raw body.
  async handlePaystackWebhook(rawBody: Buffer, signature: string): Promise<{ received: boolean }> {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!key) return { received: false };
    const expected = createHmac('sha512', key).update(rawBody).digest('hex');
    if (expected !== signature) {
      this.logger.warn('Paystack webhook signature mismatch');
      return { received: false };
    }
    try {
      const event = JSON.parse(rawBody.toString('utf8')) as { event?: string; data?: { reference?: string; amount?: number } };
      if (event.event === 'charge.success' && event.data?.reference) {
        const payment = await this.prisma.payments.findFirst({ where: { transaction_ref: event.data.reference } });
        if (payment?.invoice_id) {
          await this.recordSuccess(payment.invoice_id, (event.data.amount ?? 0) / 100, 'PAYSTACK', event.data.reference);
        }
      }
    } catch (e) {
      this.logger.error(`Paystack webhook error: ${(e as Error).message}`);
    }
    return { received: true };
  }

  // POST /api/payments/stripe/create-intent
  async createStripeIntent(dto: InitPaymentDto, user: AuthUser): Promise<ResponseObject> {
    if (!this.stripe.configured) return fail('Stripe is not configured');
    const invoice = await this.prisma.invoices.findUnique({
      where: { id: BigInt(dto.invoiceId ?? 0) },
      include: { businesses: true },
    });
    if (!invoice) return fail('Invoice not found');
    if (invoice.businesses.owner_id !== user.id && !this.isAdmin(user)) return fail('Access denied');
    try {
      const intent = await this.stripe.createPaymentIntent(
        Math.round(n(invoice.total_amount) * 100),
        invoice.currency_code ?? 'usd',
        { invoiceId: String(invoice.id) },
      );
      if (!intent) return fail('Failed to create payment intent');
      await this.prisma.payments.create({
        data: {
          invoice_id: invoice.id,
          business_id: invoice.business_id,
          amount: n(invoice.total_amount),
          currency: invoice.currency_code,
          method: 'STRIPE',
          transaction_ref: intent.id,
          status: 'PENDING',
        },
      });
      return ok('Payment intent created', { clientSecret: intent.client_secret });
    } catch (e) {
      return fail(`Failed to create payment intent: ${(e as Error).message}`);
    }
  }

  // POST /api/webhooks/stripe
  async handleStripeWebhook(rawBody: Buffer, signature: string): Promise<{ received: boolean }> {
    try {
      const event = this.stripe.constructEvent(rawBody, signature);
      if (event && event.type === 'payment_intent.succeeded') {
        const intent = event.data.object as { id: string; amount: number; metadata?: { invoiceId?: string } };
        const invoiceId = intent.metadata?.invoiceId;
        if (invoiceId) await this.recordSuccess(BigInt(invoiceId), intent.amount / 100, 'STRIPE', intent.id);
      }
      return { received: true };
    } catch (e) {
      this.logger.error(`Stripe webhook error: ${(e as Error).message}`);
      return { received: false };
    }
  }

  // POST /api/payments/manual — record a cash/transfer payment.
  async recordManual(dto: ManualPaymentDto, user: AuthUser): Promise<ResponseObject> {
    const invoice = await this.prisma.invoices.findUnique({
      where: { id: BigInt(dto.invoiceId ?? 0) },
      include: { businesses: true },
    });
    if (!invoice) return fail('Invoice not found');
    if (invoice.businesses.owner_id !== user.id && !this.isAdmin(user)) return fail('Access denied');
    const amount = dto.amount ?? n(invoice.total_amount) - n(invoice.amount_paid);
    await this.recordSuccess(invoice.id, amount, dto.method ?? 'MANUAL', dto.reference ?? null);
    const updated = await this.prisma.invoices.findUnique({ where: { id: invoice.id } });
    return ok('Payment recorded', {
      invoiceId: invoice.id,
      amountPaid: n(updated?.amount_paid ?? null),
      isPaid: updated?.is_paid ?? false,
    });
  }

  // GET /api/payments/business/:businessId
  async listByBusiness(businessId: bigint): Promise<ResponseObject> {
    const items = await this.prisma.payments.findMany({
      where: { business_id: businessId },
      orderBy: { created_at: 'desc' },
    });
    return ok(
      'Payments fetched successfully',
      items.map((p) => ({
        id: p.id,
        invoiceId: p.invoice_id,
        amount: n(p.amount),
        currency: p.currency,
        method: p.method,
        reference: p.transaction_ref,
        status: p.status,
        paidAt: p.paid_at,
        createdAt: p.created_at,
      })),
    );
  }
}
