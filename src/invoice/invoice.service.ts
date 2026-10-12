import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { PdfService, InvoicePdfModel } from '../pdf/pdf.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { toSpringPage } from '../common/dto/page';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { isPlatformAdmin } from '../common/authz/permissions';
import { mapProductEntity } from '../product/product.mapper';
import {
  carryDueDate,
  isBeforeDay,
  parseDateInput,
} from '../common/util/date.util';
import { InvoiceRequestDto, InvoiceApprovalDto } from './dto/invoice.dto';

const CURRENCY_CODES = [
  'NGN',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'AUD',
  'CAD',
  'CHF',
  'CNY',
  'INR',
];

const invoiceInclude = {
  invoice_items: { include: { products: true } },
} satisfies Prisma.invoicesInclude;
type InvoiceWithItems = Prisma.invoicesGetPayload<{
  include: typeof invoiceInclude;
}>;

// Everything the PDF/email templates need: items plus the two parties.
const invoiceWithRelationsInclude = {
  ...invoiceInclude,
  businesses: true,
  customers: true,
} satisfies Prisma.invoicesInclude;
type InvoiceWithRelations = Prisma.invoicesGetPayload<{
  include: typeof invoiceWithRelationsInclude;
}>;

const num = (d: Prisma.Decimal | null): number | null =>
  d != null ? Number(d) : null;

/** Trim free text; blank becomes null. `undefined` stays undefined (= "leave as is"). */
const cleanText = (v: string | null | undefined): string | null | undefined =>
  v === undefined ? undefined : v?.trim() || null;

const DUE_BEFORE_ISSUE = 'Due date cannot be before the invoice date';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly pdf: PdfService,
  ) {}

  // Who may call each method is decided by AuthorizationGuard from the route's
  // @BusinessPermission (maker-checker: WRITE creates/edits/sends, APPROVE is
  // owner/admin only). Services keep only the data-integrity rules, e.g. the
  // customer and products must belong to the invoice's business.

  private isAdmin(user: AuthUser): boolean {
    return isPlatformAdmin(user);
  }

  private mapInvoice(inv: InvoiceWithItems) {
    return {
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      businessId: inv.business_id,
      customerId: inv.customer_id,
      totalAmount: num(inv.total_amount),
      invoiceDate: inv.invoice_date,
      invoiceStatus: inv.invoice_status,
      recurring: inv.is_recurring, // Jackson key was "recurring"
      frequency: inv.frequency,
      currencyCode: inv.currency_code,
      isPaid: inv.is_paid,
      approvalStatus: inv.approval_status,
      amountPaid: num(inv.amount_paid),
      dueDate: inv.due_date,
      paidDate: inv.paid_date,
      notes: inv.notes,
      additionalInfo: inv.additional_info,
      items: inv.invoice_items.map((it) => {
        const unitPrice = num(it.products?.unit_price);
        const quantity = it.quantity ?? 0;
        const discount = it.discount != null ? Number(it.discount) : 0;
        const gross = (unitPrice ?? 0) * quantity;
        return {
          id: it.id,
          productId: it.product_id,
          name: it.products?.name ?? null,
          unitPrice,
          quantity,
          discount,
          totalAmount: gross - (gross * discount) / 100,
          product: mapProductEntity(it.products),
        };
      }),
    };
  }

  private async generateInvoiceNumber(): Promise<string> {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const datePart = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const count = await this.prisma.invoices.count();
    return `NTRN-INV-${datePart}-${String(count + 1).padStart(4, '0')}`;
  }

  /** Build invoice item rows (repricing/creating products) and accumulate the discounted total. */
  private async buildItemsAndTotal(
    items: InvoiceRequestDto['items'],
    businessId: bigint,
  ): Promise<{
    itemsData: { product_id: bigint; quantity: number; discount: bigint }[];
    total: number;
  }> {
    let total = 0;
    const itemsData: {
      product_id: bigint;
      quantity: number;
      discount: bigint;
    }[] = [];
    for (const it of items ?? []) {
      let productId: bigint;
      let unitPrice: number;
      if (it.productId != null) {
        const product = await this.prisma.products.findUnique({
          where: { id: BigInt(it.productId) },
        });
        // A product from another business must not be billed — or repriced below.
        if (!product || product.business_id !== businessId)
          throw new Error('Product not found');
        unitPrice = Number(product.unit_price ?? 0);
        if (it.unitPrice != null && Number(it.unitPrice) !== unitPrice) {
          await this.prisma.products.update({
            where: { id: product.id },
            data: { unit_price: it.unitPrice },
          });
          unitPrice = Number(it.unitPrice);
        }
        productId = product.id;
      } else {
        const p = it.product ?? {};
        const created = await this.prisma.products.create({
          data: {
            name: p.name,
            unit_price: p.unitPrice,
            is_product_active: p.isProductActive ?? true,
            category_id: p.categoryId != null ? BigInt(p.categoryId) : null,
            business_id: businessId,
          },
        });
        unitPrice = Number(created.unit_price ?? 0);
        productId = created.id;
      }
      const qty = it.quantity ?? 0;
      const pct = it.discount ?? 0;
      const qtyPrice = qty * unitPrice;
      total += qtyPrice - (qtyPrice * pct) / 100;
      itemsData.push({
        product_id: productId,
        quantity: qty,
        discount: BigInt(Math.trunc(pct)),
      });
    }
    return { itemsData, total };
  }

  // 3.1 — WRITE (guard) + verified account
  async createInvoice(
    dto: InvoiceRequestDto,
    user: AuthUser,
  ): Promise<ResponseObject> {
    const dbUser = await this.prisma.users.findUnique({
      where: { id: user.id },
    });
    if (!dbUser?.verified)
      return fail('Please verify your account to be able to create an invoice');
    const business = await this.prisma.businesses.findUnique({
      where: { id: BigInt(dto.businessId ?? 0) },
      include: { customers: true },
    });
    if (!business) throw new Error('Business not found');
    const customer = await this.prisma.customers.findUnique({
      where: { id: BigInt(dto.customerId ?? 0) },
    });
    if (!customer) throw new Error('Customer not found');
    if (!business.customers.some((c) => c.email === customer.email)) {
      return fail('Customer does not belong to the specified business');
    }
    if (customer.business_id !== business.id)
      return fail('Customer does not belong to the specified business');
    const invoiceDate = parseDateInput(dto.invoiceDate) ?? new Date();
    const dueDate = parseDateInput(dto.dueDate);
    if (dueDate && isBeforeDay(dueDate, invoiceDate))
      return fail(DUE_BEFORE_ISSUE);
    try {
      const { itemsData, total } = await this.buildItemsAndTotal(
        dto.items,
        business.id,
      );
      const invoice = await this.prisma.invoices.create({
        data: {
          invoice_number: await this.generateInvoiceNumber(),
          business_id: business.id,
          customer_id: customer.id,
          invoice_date: invoiceDate,
          due_date: dueDate,
          notes: cleanText(dto.notes),
          additional_info: cleanText(dto.additionalInfo),
          currency_code: dto.currencyCode,
          is_recurring: dto.isRecurring ?? dto.recurring ?? false,
          frequency: dto.frequency,
          invoice_status: 'pending',
          approval_status: 'pending',
          is_paid: false,
          total_amount: total,
          invoice_items: { create: itemsData },
        },
        include: invoiceInclude,
      });
      return ok('Invoice generated successfully', this.mapInvoice(invoice));
    } catch (e) {
      return fail(`Failed  to generate Invoice: ${(e as Error).message}`);
    }
  }

  // 3.2 — VIEW (guard)
  async getBusinessInvoices(businessId: bigint): Promise<ResponseObject> {
    try {
      const business = await this.prisma.businesses.findUnique({
        where: { id: businessId },
        include: { invoices: { include: invoiceInclude } },
      });
      if (!business) throw new Error('Business not found');
      return ok(
        'Business Invoices fetched successfully',
        business.invoices.map((i) => this.mapInvoice(i)),
      );
    } catch (e) {
      return fail(`Failed to fetch business invoices: ${(e as Error).message}`);
    }
  }

  // 3.3 — WRITE (guard); not once sent/approved. Stays in its own business.
  async updateInvoice(
    invoiceId: bigint,
    dto: InvoiceRequestDto,
  ): Promise<ResponseObject> {
    const invoice = await this.prisma.invoices.findUnique({
      where: { id: invoiceId },
      include: { businesses: true },
    });
    if (!invoice) throw new Error('Invoice not found');
    if (
      invoice.invoice_status === 'sent' ||
      invoice.approval_status === 'approved'
    ) {
      return fail(
        'You can no longer edit this invoice, invoice is  already sent or approved',
      );
    }
    const business = invoice.businesses;
    const customer = await this.prisma.customers.findUnique({
      where: { id: BigInt(dto.customerId ?? 0) },
    });
    if (!customer) throw new Error('Customer not found');
    if (customer.business_id !== business.id)
      return fail('Customer does not belong to the specified business');
    // Omitted fields keep their stored value; an explicit null dueDate clears it.
    const invoiceDate =
      parseDateInput(dto.invoiceDate) ?? invoice.invoice_date ?? new Date();
    const dueDate =
      dto.dueDate === undefined
        ? invoice.due_date
        : parseDateInput(dto.dueDate);
    if (dueDate && isBeforeDay(dueDate, invoiceDate))
      return fail(DUE_BEFORE_ISSUE);
    try {
      const { itemsData, total } = await this.buildItemsAndTotal(
        dto.items,
        business.id,
      );
      await this.prisma.invoice_items.deleteMany({
        where: { invoice_id: invoiceId },
      });
      const updated = await this.prisma.invoices.update({
        where: { id: invoiceId },
        data: {
          invoice_date: invoiceDate,
          due_date: dueDate,
          notes: cleanText(dto.notes),
          additional_info: cleanText(dto.additionalInfo),
          is_recurring:
            dto.isRecurring ?? dto.recurring ?? invoice.is_recurring,
          frequency: dto.frequency,
          total_amount: total,
          invoice_items: { create: itemsData },
        },
        include: invoiceInclude,
      });
      return ok('Invoice updated successfully', this.mapInvoice(updated));
    } catch (e) {
      return fail(`Failed  to update Invoice: ${(e as Error).message}`);
    }
  }

  // 3.4 — admin
  async getAllInvoicesInPagination(
    page: number,
    size: number,
    user: AuthUser,
  ): Promise<ResponseObject> {
    if (!this.isAdmin(user)) return fail('Only Admin privilege');
    try {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.invoices.findMany({
          skip: page * size,
          take: size,
          include: invoiceInclude,
        }),
        this.prisma.invoices.count(),
      ]);
      return ok(
        'Paged Invoices fetched successfully',
        toSpringPage(
          items.map((i) => this.mapInvoice(i)),
          page,
          size,
          total,
        ),
      );
    } catch (e) {
      return fail(`Failed to fetch paged invoices: ${(e as Error).message}`);
    }
  }

  private async loadInvoice(id: bigint) {
    const invoice = await this.prisma.invoices.findUnique({
      where: { id },
      include: invoiceWithRelationsInclude,
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  // 3.5 — VIEW (guard)
  async getInvoice(invoiceId: bigint): Promise<ResponseObject> {
    try {
      const invoice = await this.loadInvoice(invoiceId);
      return ok('Invoice fetched successfully', this.mapInvoice(invoice));
    } catch (e) {
      return fail(`Failed  to fetch Invoice.${(e as Error).message}`);
    }
  }

  // 3.6
  getCurrencyCodes(): ResponseObject {
    return ok('Currency codes fetched successfully', CURRENCY_CODES);
  }

  // 3.7 — checker step: APPROVE (owner/admin; guard)
  async approveInvoice(dto: InvoiceApprovalDto): Promise<ResponseObject> {
    try {
      const status = (dto.approvalStatus ?? 'approved').toLowerCase();
      if (!['approved', 'rejected', 'pending'].includes(status)) {
        return fail(
          'Invalid approval status. Use approved, rejected or pending.',
        );
      }
      const invoice = await this.prisma.invoices.findUnique({
        where: { id: BigInt(dto.invoiceId ?? 0) },
        include: { businesses: true },
      });
      if (!invoice) throw new Error('Invoice not found');
      if (invoice.invoice_status === 'sent') {
        return fail(
          'This invoice has already been sent and can no longer be re-approved.',
        );
      }
      const updated = await this.prisma.invoices.update({
        where: { id: invoice.id },
        data: { approval_status: status },
        include: invoiceInclude,
      });
      const verb =
        status === 'rejected'
          ? 'rejected'
          : status === 'pending'
            ? 'reset to pending'
            : 'approved';
      return ok(`Invoice ${verb} successfully`, this.mapInvoice(updated));
    } catch (e) {
      return fail(`Failed  to approve Invoice: ${(e as Error).message}`);
    }
  }

  // 3.8 — WRITE (guard): a maker may send, but only once the checker approved
  async sendInvoice(invoiceId: bigint): Promise<ResponseObject> {
    const invoice = await this.prisma.invoices.findUnique({
      where: { id: invoiceId },
      include: {
        businesses: true,
        customers: true,
        invoice_items: { include: { products: true } },
      },
    });
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.approval_status !== 'approved') {
      return fail(
        'Failed  to send Invoice. Invoice must be approved before it can be sent  ',
      );
    }
    const recipient = invoice.customers?.email;
    if (!recipient) {
      return fail(
        'Failed  to send Invoice. This customer has no email address on file.',
      );
    }
    try {
      const model = this.toPdfModel(invoice);

      // Attach the designed PDF. A render failure must not block the email, so
      // fall back to sending the itemised HTML on its own.
      let pdf: Buffer | null = null;
      try {
        pdf = await this.pdf.generateDefaultTemplatePdf(model);
      } catch (e) {
        this.logger.warn(
          `Invoice ${invoice.invoice_number}: PDF attachment skipped — ${(e as Error).message}`,
        );
      }

      await this.email.sendInvoiceEmail({
        to: recipient,
        customerName: model.customer.name ?? '',
        businessName: model.business?.name ?? 'your supplier',
        businessEmail: model.business?.email ?? null,
        invoiceNumber: model.invoiceNumber ?? '',
        invoiceDate: model.invoiceDate,
        dueDate: model.dueDate ?? null,
        notes: model.notes ?? null,
        additionalInfo: model.additionalInfo ?? null,
        currencyCode: model.currencyCode ?? 'NGN',
        totalAmount: model.totalAmount ?? 0,
        amountPaid: model.amountPaid ?? 0,
        items: model.items.map((it) => ({
          name: it.product.name ?? 'Item',
          quantity: it.quantity,
          unitPrice: it.product.unitPrice ?? 0,
          amount: it.amount ?? 0,
        })),
        pdf,
      });

      await this.prisma.invoices.update({
        where: { id: invoice.id },
        data: { invoice_status: 'sent' },
      });
      // NOTE: legacy B2B bill side-effect (generateBillFromInvoice/appendP2Pbill) intentionally omitted.
      return ok('Invoice sent successfully', 'Email sent successfully');
    } catch (e) {
      return fail(`Failed  to send Invoice: ${(e as Error).message}`);
    }
  }

  /**
   * Build the model both the PDF and the customer email render from. Line and
   * total amounts are computed here so the templates stay presentation-only.
   */
  private toPdfModel(inv: InvoiceWithRelations): InvoicePdfModel {
    const items = inv.invoice_items.map((it) => {
      const unitPrice = num(it.products?.unit_price) ?? 0;
      const quantity = it.quantity ?? 0;
      const discount = it.discount != null ? Number(it.discount) : 0;
      const gross = unitPrice * quantity;
      return {
        product: { name: it.products?.name ?? null, unitPrice },
        quantity,
        discount,
        gross,
        amount: gross - (gross * discount) / 100,
      };
    });
    const subtotal = items.reduce((sum, it) => sum + it.gross, 0);
    const discountTotal =
      subtotal - items.reduce((sum, it) => sum + it.amount, 0);
    const totalAmount = num(inv.total_amount) ?? 0;
    const amountPaid = num(inv.amount_paid) ?? 0;

    const customerName =
      [inv.customers?.first_name, inv.customers?.last_name]
        .filter(Boolean)
        .join(' ') || null;

    return {
      invoiceNumber: inv.invoice_number,
      customer: {
        id: inv.customer_id,
        name: customerName,
        email: inv.customers?.email ?? null,
        address: inv.customers?.address ?? null,
      },
      business: {
        name: inv.businesses?.business_name ?? null,
        email: inv.businesses?.business_email ?? null,
        address: inv.businesses?.business_address ?? null,
        phone: inv.businesses?.business_phone ?? null,
        taxId: inv.businesses?.tax_id ?? null,
        paymentTermsDays: inv.businesses?.payment_terms_days ?? null,
      },
      invoiceDate: inv.invoice_date,
      dueDate: inv.due_date ?? null,
      invoiceStatus: inv.invoice_status,
      isPaid: inv.is_paid,
      totalAmount,
      amountPaid,
      balanceDue: Math.max(totalAmount - amountPaid, 0),
      subtotal,
      discountTotal,
      currencyCode: inv.currency_code,
      notes: inv.notes,
      additionalInfo: inv.additional_info,
      items,
    };
  }

  // 3.9 — PDF (raw), VIEW (guard). Returns a binary buffer (streamed by the controller).
  async downloadRaw(id: bigint): Promise<Buffer> {
    const invoice = await this.loadInvoice(id);
    return this.pdf.generateRawPdf(this.toPdfModel(invoice));
  }

  // 3.10 — PDF (default template), VIEW (guard)
  async downloadDefaultTemplate(id: bigint): Promise<Buffer> {
    const invoice = await this.loadInvoice(id);
    return this.pdf.generateDefaultTemplatePdf(this.toPdfModel(invoice));
  }

  // DELETE /invoices/invoice/delete/:id — DELETE (guard).
  // Cleans up items and any recurring schedule referencing it.
  async deleteInvoice(invoiceId: bigint): Promise<ResponseObject> {
    try {
      const invoice = await this.prisma.invoices.findUnique({
        where: { id: invoiceId },
      });
      if (!invoice) return fail('Invoice not found');
      await this.prisma.recurringinvoices.deleteMany({
        where: { invoice_id: invoiceId },
      });
      await this.prisma.invoice_items.deleteMany({
        where: { invoice_id: invoiceId },
      });
      await this.prisma.invoices.delete({ where: { id: invoiceId } });
      return ok('Invoice deleted successfully');
    } catch (e) {
      return fail(`Failed to delete invoice: ${(e as Error).message}`);
    }
  }

  // POST /invoices/invoice/duplicate/:id — WRITE (guard); clone into a new draft.
  async duplicateInvoice(invoiceId: bigint): Promise<ResponseObject> {
    try {
      const src = await this.prisma.invoices.findUnique({
        where: { id: invoiceId },
        include: { invoice_items: true },
      });
      if (!src) return fail('Invoice not found');
      const now = new Date();
      const dup = await this.prisma.invoices.create({
        data: {
          invoice_number: await this.generateInvoiceNumber(),
          business_id: src.business_id,
          customer_id: src.customer_id,
          invoice_date: now,
          due_date: carryDueDate(src.invoice_date, src.due_date, now),
          notes: src.notes,
          additional_info: src.additional_info,
          currency_code: src.currency_code,
          is_recurring: false,
          frequency: src.frequency,
          invoice_status: 'pending',
          approval_status: 'pending',
          is_paid: false,
          total_amount: src.total_amount,
          invoice_items: {
            create: src.invoice_items.map((it) => ({
              product_id: it.product_id,
              quantity: it.quantity,
              discount: it.discount,
            })),
          },
        },
        include: invoiceInclude,
      });
      return ok('Invoice duplicated successfully', this.mapInvoice(dup));
    } catch (e) {
      return fail(`Failed to duplicate invoice: ${(e as Error).message}`);
    }
  }
}
