import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { PdfService, InvoicePdfModel } from '../pdf/pdf.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { toSpringPage } from '../common/dto/page';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { mapProductEntity } from '../product/product.mapper';
import { InvoiceRequestDto, InvoiceApprovalDto } from './dto/invoice.dto';

const CURRENCY_CODES = ['NGN', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'INR'];

const invoiceInclude = { invoice_items: { include: { products: true } } } satisfies Prisma.invoicesInclude;
type InvoiceWithItems = Prisma.invoicesGetPayload<{ include: typeof invoiceInclude }>;

const num = (d: Prisma.Decimal | null): number | null => (d != null ? Number(d) : null);

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly pdf: PdfService,
  ) {}

  private isAdmin(user: AuthUser): boolean {
    return user.roles.includes(Role.ADMIN);
  }

  /**
   * Maker-checker access. A "maker" is the business owner or any team member
   * (business_members); admins too. Makers can create/send invoices; approval
   * (the "checker" step) stays owner/admin only — see approveInvoice.
   * Pass a business that was loaded with `business_members` included.
   */
  private isOwnerMemberOrAdmin(
    biz: { owner_id: bigint | null; business_members?: { user_id: bigint }[] } | null,
    user: AuthUser,
  ): boolean {
    if (!biz) return false;
    if (this.isAdmin(user)) return true;
    if (biz.owner_id === user.id) return true;
    return (biz.business_members ?? []).some((m) => m.user_id === user.id);
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
  ): Promise<{ itemsData: { product_id: bigint; quantity: number; discount: bigint }[]; total: number }> {
    let total = 0;
    const itemsData: { product_id: bigint; quantity: number; discount: bigint }[] = [];
    for (const it of items ?? []) {
      let productId: bigint;
      let unitPrice: number;
      if (it.productId != null) {
        const product = await this.prisma.products.findUnique({ where: { id: BigInt(it.productId) } });
        if (!product) throw new Error('Product not found');
        unitPrice = Number(product.unit_price ?? 0);
        if (it.unitPrice != null && Number(it.unitPrice) !== unitPrice) {
          await this.prisma.products.update({ where: { id: product.id }, data: { unit_price: it.unitPrice } });
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
      itemsData.push({ product_id: productId, quantity: qty, discount: BigInt(Math.trunc(pct)) });
    }
    return { itemsData, total };
  }

  // 3.1 — verified + owner
  async createInvoice(dto: InvoiceRequestDto, user: AuthUser): Promise<ResponseObject> {
    const dbUser = await this.prisma.users.findUnique({ where: { id: user.id } });
    if (!dbUser?.verified) return fail('Please verify your account to be able to create an invoice');
    const business = await this.prisma.businesses.findUnique({
      where: { id: BigInt(dto.businessId ?? 0) },
      include: { customers: true, business_members: true },
    });
    if (!business) throw new Error('Business not found');
    // Maker step: owner or any team member may draft an invoice.
    if (!this.isOwnerMemberOrAdmin(business, user)) {
      return fail('You do not have permission to create an invoice for this business');
    }
    const customer = await this.prisma.customers.findUnique({ where: { id: BigInt(dto.customerId ?? 0) } });
    if (!customer) throw new Error('Customer not found');
    if (!business.customers.some((c) => c.email === customer.email)) {
      return fail('Customer does not belong to the specified business');
    }
    if (customer.business_id !== business.id) return fail('Customer does not belong to the specified business');
    try {
      const { itemsData, total } = await this.buildItemsAndTotal(dto.items, business.id);
      const invoice = await this.prisma.invoices.create({
        data: {
          invoice_number: await this.generateInvoiceNumber(),
          business_id: business.id,
          customer_id: customer.id,
          invoice_date: new Date(),
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

  // 3.2 — owner or admin
  async getBusinessInvoices(businessId: bigint, user: AuthUser): Promise<ResponseObject> {
    try {
      const business = await this.prisma.businesses.findUnique({
        where: { id: businessId },
        include: { invoices: { include: invoiceInclude }, business_members: true },
      });
      if (!business) throw new Error('Business not found');
      // Owner, team members and admins can all view the business's invoices.
      if (this.isOwnerMemberOrAdmin(business, user)) {
        return ok('Business Invoices fetched successfully', business.invoices.map((i) => this.mapInvoice(i)));
      }
      return fail('You do not have access to this business invoices');
    } catch (e) {
      return fail(`Failed to fetch business invoices: ${(e as Error).message}`);
    }
  }

  // 3.3 — owner; not sent/approved
  async updateInvoice(invoiceId: bigint, dto: InvoiceRequestDto, user: AuthUser): Promise<ResponseObject> {
    const invoice = await this.prisma.invoices.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.invoice_status === 'sent' || invoice.approval_status === 'approved') {
      return fail('You can no longer edit this invoice, invoice is  already sent or approved');
    }
    const business = await this.prisma.businesses.findUnique({ where: { id: BigInt(dto.businessId ?? 0) } });
    if (!business) throw new Error('Business not found');
    if (business.owner_id !== user.id) throw new Error('You do not have permission to update this invoice');
    const customer = await this.prisma.customers.findUnique({ where: { id: BigInt(dto.customerId ?? 0) } });
    if (!customer) throw new Error('Customer not found');
    if (customer.business_id !== business.id) return fail('Customer does not belong to the specified business');
    try {
      const { itemsData, total } = await this.buildItemsAndTotal(dto.items, business.id);
      await this.prisma.invoice_items.deleteMany({ where: { invoice_id: invoiceId } });
      const updated = await this.prisma.invoices.update({
        where: { id: invoiceId },
        data: {
          invoice_date: new Date(),
          is_recurring: dto.isRecurring ?? dto.recurring ?? invoice.is_recurring,
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
  async getAllInvoicesInPagination(page: number, size: number, user: AuthUser): Promise<ResponseObject> {
    if (!this.isAdmin(user)) return fail('Only Admin privilege');
    try {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.invoices.findMany({ skip: page * size, take: size, include: invoiceInclude }),
        this.prisma.invoices.count(),
      ]);
      return ok('Paged Invoices fetched successfully', toSpringPage(items.map((i) => this.mapInvoice(i)), page, size, total));
    } catch (e) {
      return fail(`Failed to fetch paged invoices: ${(e as Error).message}`);
    }
  }

  private async resolveInvoiceForOwnerOrAdmin(id: bigint, user: AuthUser): Promise<InvoiceWithItems & { customer_id: bigint }> {
    const invoice = await this.prisma.invoices.findUnique({
      where: { id },
      include: { ...invoiceInclude, businesses: true },
    });
    if (!invoice) throw new Error('Invoice not found');
    const isOwner = invoice.businesses.owner_id === user.id;
    if (!isOwner && !this.isAdmin(user)) throw new ForbiddenException('You do not have access to this invoice');
    return invoice;
  }

  // 3.5 — owner or admin
  async getInvoice(invoiceId: bigint, user: AuthUser): Promise<ResponseObject> {
    try {
      const invoice = await this.resolveInvoiceForOwnerOrAdmin(invoiceId, user);
      return ok('Invoice fetched successfully', this.mapInvoice(invoice));
    } catch (e) {
      return fail(`Failed  to fetch Invoice.${(e as Error).message}`);
    }
  }

  // 3.6
  getCurrencyCodes(): ResponseObject {
    return ok('Currency codes fetched successfully', CURRENCY_CODES);
  }

  // 3.7 — checker step: owner or admin only (a maker cannot approve their own work)
  async approveInvoice(dto: InvoiceApprovalDto, user: AuthUser): Promise<ResponseObject> {
    try {
      const status = (dto.approvalStatus ?? 'approved').toLowerCase();
      if (!['approved', 'rejected', 'pending'].includes(status)) {
        return fail('Invalid approval status. Use approved, rejected or pending.');
      }
      const invoice = await this.prisma.invoices.findUnique({
        where: { id: BigInt(dto.invoiceId ?? 0) },
        include: { businesses: true },
      });
      if (!invoice) throw new Error('Invoice not found');
      // Only the business owner (or an admin) may approve/reject — the checker.
      if (invoice.businesses.owner_id !== user.id && !this.isAdmin(user)) {
        throw new Error('Only the business owner can approve this invoice');
      }
      if (invoice.invoice_status === 'sent') {
        return fail('This invoice has already been sent and can no longer be re-approved.');
      }
      const updated = await this.prisma.invoices.update({
        where: { id: invoice.id },
        data: { approval_status: status },
        include: invoiceInclude,
      });
      const verb = status === 'rejected' ? 'rejected' : status === 'pending' ? 'reset to pending' : 'approved';
      return ok(`Invoice ${verb} successfully`, this.mapInvoice(updated));
    } catch (e) {
      return fail(`Failed  to approve Invoice: ${(e as Error).message}`);
    }
  }

  // 3.8 — maker (owner/member/admin) may send, but only once the checker approved
  async sendInvoice(invoiceId: bigint, user: AuthUser): Promise<ResponseObject> {
    const invoice = await this.prisma.invoices.findUnique({
      where: { id: invoiceId },
      include: {
        businesses: { include: { business_members: true } },
        customers: true,
        invoice_items: { include: { products: true } },
      },
    });
    if (!invoice) throw new Error('Invoice not found');
    if (!this.isOwnerMemberOrAdmin(invoice.businesses, user)) {
      return fail('Failed  to send Invoice. You do not have access to this business.');
    }
    if (invoice.approval_status !== 'approved') {
      return fail('Failed  to send Invoice. Invoice must be approved before it can be sent  ');
    }
    try {
      const billingUser = await this.prisma.users.findUnique({ where: { id: user.id } });
      const senderName = `${billingUser?.first_name ?? ''}${billingUser?.last_name ?? ''}`;
      const subject = `Invoice from ${senderName} - Invoice #${invoice.invoice_number}`;
      const rows = invoice.invoice_items
        .map(
          (it) =>
            `<tr><td>${it.products.name ?? ''}</td><td>${it.quantity}</td><td>${num(it.products.unit_price) ?? ''}</td></tr>`,
        )
        .join('');
      const html = `<h2>Invoice from ${invoice.businesses.business_name ?? ''}</h2>
        <p>Invoice Number: ${invoice.invoice_number}</p>
        <table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Product</th><th>Quantity</th><th>Price</th></tr></thead><tbody>${rows}</tbody></table>
        <p><strong>Total Amount: ${num(invoice.total_amount)} ${invoice.currency_code ?? ''}</strong></p>
        <p>Kindly pay within 4 business days.</p><p>© 2025 ${invoice.businesses.business_name ?? ''}</p>`;
      await this.email.sendMail(invoice.customers.email ?? '', subject, html);
      await this.prisma.invoices.update({ where: { id: invoice.id }, data: { invoice_status: 'sent' } });
      // NOTE: legacy B2B bill side-effect (generateBillFromInvoice/appendP2Pbill) intentionally omitted.
      return ok('Invoice sent successfully', 'Email sent successfully');
    } catch (e) {
      return fail(`Failed  to send Invoice: ${(e as Error).message}`);
    }
  }

  private toPdfModel(inv: InvoiceWithItems & { customer_id: bigint }): InvoicePdfModel {
    return {
      invoiceNumber: inv.invoice_number,
      customer: { id: inv.customer_id },
      invoiceDate: inv.invoice_date,
      invoiceStatus: inv.invoice_status,
      isPaid: inv.is_paid,
      totalAmount: num(inv.total_amount),
      currencyCode: inv.currency_code,
      items: inv.invoice_items.map((it) => ({
        product: { name: it.products.name, unitPrice: num(it.products.unit_price) },
        quantity: it.quantity,
      })),
    };
  }

  // 3.9 — PDF (raw). Returns a binary buffer (streamed by the controller).
  async downloadRaw(id: bigint, user: AuthUser): Promise<Buffer> {
    const invoice = await this.resolveInvoiceForOwnerOrAdmin(id, user);
    return this.pdf.generateRawPdf(this.toPdfModel(invoice));
  }

  // 3.10 — PDF (default template)
  async downloadDefaultTemplate(id: bigint, user: AuthUser): Promise<Buffer> {
    const invoice = await this.resolveInvoiceForOwnerOrAdmin(id, user);
    return this.pdf.generateDefaultTemplatePdf(this.toPdfModel(invoice));
  }

  // DELETE /invoices/invoice/delete/:id — the frontend calls this (was a 404).
  // Owner-or-admin; cleans up items and any recurring schedule referencing it.
  async deleteInvoice(invoiceId: bigint, user: AuthUser): Promise<ResponseObject> {
    try {
      const invoice = await this.prisma.invoices.findUnique({
        where: { id: invoiceId },
        include: { businesses: true },
      });
      if (!invoice) return fail('Invoice not found');
      if (invoice.businesses.owner_id !== user.id && !this.isAdmin(user)) {
        return fail('You do not have permission to delete this invoice');
      }
      await this.prisma.recurringinvoices.deleteMany({ where: { invoice_id: invoiceId } });
      await this.prisma.invoice_items.deleteMany({ where: { invoice_id: invoiceId } });
      await this.prisma.invoices.delete({ where: { id: invoiceId } });
      return ok('Invoice deleted successfully');
    } catch (e) {
      return fail(`Failed to delete invoice: ${(e as Error).message}`);
    }
  }

  // POST /invoices/invoice/duplicate/:id — clone an invoice into a new draft.
  async duplicateInvoice(invoiceId: bigint, user: AuthUser): Promise<ResponseObject> {
    try {
      const src = await this.prisma.invoices.findUnique({
        where: { id: invoiceId },
        include: { invoice_items: true, businesses: true },
      });
      if (!src) return fail('Invoice not found');
      if (src.businesses.owner_id !== user.id && !this.isAdmin(user)) return fail('Access denied');
      const dup = await this.prisma.invoices.create({
        data: {
          invoice_number: await this.generateInvoiceNumber(),
          business_id: src.business_id,
          customer_id: src.customer_id,
          invoice_date: new Date(),
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

