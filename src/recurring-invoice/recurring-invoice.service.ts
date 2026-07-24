import { Injectable, Logger } from '@nestjs/common';
import { Prisma, recurringinvoices } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { CreateRecurringInvoiceDto, UpdateRecurringInvoiceDto } from './dto/recurring-invoice.dto';

const ymd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const num = (d: Prisma.Decimal | null): number | null => (d != null ? Number(d) : null);

@Injectable()
export class RecurringInvoiceService {
  private readonly logger = new Logger(RecurringInvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  private isAdmin(user: AuthUser): boolean {
    return user.roles.includes(Role.ADMIN);
  }

  private mapDTO(r: recurringinvoices) {
    return {
      id: r.id,
      templateInvoiceId: r.invoice_id,
      businessId: r.business_id,
      frequency: r.frequency,
      startDate: ymd(r.start_date),
      endDate: ymd(r.end_date),
      nextInvoiceDate: ymd(r.next_invoice_date),
      lastGeneratedDate: ymd(r.last_generated_date),
      dayOfMonth: r.day_of_month,
      isActive: r.is_active,
      autoSend: r.auto_send,
      generatedCount: r.generated_count,
      maxOccurrences: r.max_occurrences,
    };
  }

  /** Advance a date by one period of the given frequency, clamping day-of-month. */
  private advance(from: Date, frequency: string | null, dayOfMonth: number | null): Date {
    const d = new Date(from);
    switch (frequency) {
      case 'WEEKLY':
        d.setDate(d.getDate() + 7);
        return d;
      case 'QUARTERLY':
        d.setMonth(d.getMonth() + 3);
        break;
      case 'ANNUALLY':
        d.setFullYear(d.getFullYear() + 1);
        break;
      case 'MONTHLY':
      default:
        d.setMonth(d.getMonth() + 1);
        break;
    }
    if (dayOfMonth) {
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(dayOfMonth, daysInMonth));
    }
    return d;
  }

  private async ownsBusiness(businessId: bigint | null, user: AuthUser): Promise<boolean> {
    if (this.isAdmin(user)) return true;
    if (businessId == null) return false;
    const b = await this.prisma.businesses.findUnique({ where: { id: businessId } });
    return !!b && b.owner_id === user.id;
  }

  // POST /api/recurring-invoices
  async create(dto: CreateRecurringInvoiceDto, user: AuthUser): Promise<ResponseObject> {
    try {
      if (!dto.templateInvoiceId) return fail('templateInvoiceId is required');
      const template = await this.prisma.invoices.findUnique({
        where: { id: BigInt(dto.templateInvoiceId) },
        include: { businesses: true },
      });
      if (!template) return fail('Template invoice not found');
      if (template.businesses.owner_id !== user.id && !this.isAdmin(user)) {
        return fail('You do not have permission to schedule this invoice');
      }
      const frequency = dto.frequency ?? 'MONTHLY';
      const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
      const rec = await this.prisma.recurringinvoices.create({
        data: {
          invoice_id: template.id,
          business_id: template.business_id,
          frequency,
          start_date: startDate,
          end_date: dto.endDate ? new Date(dto.endDate) : null,
          next_invoice_date: startDate,
          day_of_month: dto.dayOfMonth ?? null,
          is_active: true,
          auto_send: dto.autoSend ?? false,
          generated_count: 0,
          max_occurrences: dto.maxOccurrences ?? null,
        },
      });
      // Flag the template so the UI reflects it.
      await this.prisma.invoices.update({
        where: { id: template.id },
        data: { is_recurring: true, frequency },
      });
      return ok('Recurring invoice created successfully', this.mapDTO(rec));
    } catch (e) {
      return fail(`Failed to create recurring invoice: ${(e as Error).message}`);
    }
  }

  // GET /api/recurring-invoices/business/:businessId
  async getByBusiness(businessId: bigint, user: AuthUser): Promise<ResponseObject> {
    try {
      if (!(await this.ownsBusiness(businessId, user))) {
        return fail('You do not have access to this business');
      }
      const items = await this.prisma.recurringinvoices.findMany({
        where: { business_id: businessId },
        orderBy: { next_invoice_date: 'asc' },
      });
      return ok('Recurring invoices fetched successfully', items.map((r) => this.mapDTO(r)));
    } catch (e) {
      return fail(`Failed to fetch recurring invoices: ${(e as Error).message}`);
    }
  }

  // GET /api/recurring-invoices/:id
  async getById(id: bigint, user: AuthUser): Promise<ResponseObject> {
    const rec = await this.prisma.recurringinvoices.findUnique({ where: { id } });
    if (!rec) return fail('Recurring invoice not found');
    if (!(await this.ownsBusiness(rec.business_id, user))) return fail('Access denied');
    return ok('Recurring invoice fetched successfully', this.mapDTO(rec));
  }

  // PUT /api/recurring-invoices/:id
  async update(id: bigint, dto: UpdateRecurringInvoiceDto, user: AuthUser): Promise<ResponseObject> {
    try {
      const rec = await this.prisma.recurringinvoices.findUnique({ where: { id } });
      if (!rec) return fail('Recurring invoice not found');
      if (!(await this.ownsBusiness(rec.business_id, user))) return fail('Access denied');
      const updated = await this.prisma.recurringinvoices.update({
        where: { id },
        data: {
          frequency: dto.frequency ?? undefined,
          end_date: dto.endDate ? new Date(dto.endDate) : undefined,
          day_of_month: dto.dayOfMonth ?? undefined,
          auto_send: dto.autoSend ?? undefined,
          max_occurrences: dto.maxOccurrences ?? undefined,
          is_active: dto.isActive ?? undefined,
        },
      });
      return ok('Recurring invoice updated successfully', this.mapDTO(updated));
    } catch (e) {
      return fail(`Failed to update recurring invoice: ${(e as Error).message}`);
    }
  }

  // DELETE /api/recurring-invoices/:id
  async remove(id: bigint, user: AuthUser): Promise<ResponseObject> {
    try {
      const rec = await this.prisma.recurringinvoices.findUnique({ where: { id } });
      if (!rec) return fail('Recurring invoice not found');
      if (!(await this.ownsBusiness(rec.business_id, user))) return fail('Access denied');
      await this.prisma.recurringinvoices.delete({ where: { id } });
      if (rec.invoice_id) {
        await this.prisma.invoices.update({ where: { id: rec.invoice_id }, data: { is_recurring: false } }).catch(() => {});
      }
      return ok('Recurring invoice deleted successfully');
    } catch (e) {
      return fail(`Failed to delete recurring invoice: ${(e as Error).message}`);
    }
  }

  async setActive(id: bigint, active: boolean, user: AuthUser): Promise<ResponseObject> {
    const rec = await this.prisma.recurringinvoices.findUnique({ where: { id } });
    if (!rec) return fail('Recurring invoice not found');
    if (!(await this.ownsBusiness(rec.business_id, user))) return fail('Access denied');
    const updated = await this.prisma.recurringinvoices.update({ where: { id }, data: { is_active: active } });
    return ok(active ? 'Recurring invoice resumed' : 'Recurring invoice paused', this.mapDTO(updated));
  }

  private async invoiceNumber(): Promise<string> {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const datePart = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const count = await this.prisma.invoices.count();
    return `NTRN-INV-${datePart}-${String(count + 1).padStart(4, '0')}`;
  }

  /** Clone a template invoice into a fresh, non-recurring invoice instance. */
  private async cloneInvoice(templateId: bigint) {
    const template = await this.prisma.invoices.findUnique({
      where: { id: templateId },
      include: { invoice_items: true },
    });
    if (!template) return null;
    return this.prisma.invoices.create({
      data: {
        invoice_number: await this.invoiceNumber(),
        business_id: template.business_id,
        customer_id: template.customer_id,
        invoice_date: new Date(),
        currency_code: template.currency_code,
        is_recurring: false,
        frequency: template.frequency,
        invoice_status: 'pending',
        approval_status: 'pending',
        is_paid: false,
        total_amount: template.total_amount,
        invoice_items: {
          create: template.invoice_items.map((it) => ({
            product_id: it.product_id,
            quantity: it.quantity,
            discount: it.discount,
          })),
        },
      },
      include: { customers: true, businesses: true, invoice_items: { include: { products: true } } },
    });
  }

  /**
   * Called by the daily scheduler. Generates an invoice for every active
   * schedule whose next_invoice_date is due, advances the schedule, and
   * deactivates schedules that have reached their end date / max occurrences.
   */
  async generateDue(): Promise<{ generated: number }> {
    const now = new Date();
    const due = await this.prisma.recurringinvoices.findMany({
      where: { is_active: true, next_invoice_date: { lte: now } },
    });
    let generated = 0;
    for (const r of due) {
      try {
        if (!r.invoice_id) continue;
        if (r.end_date && now > r.end_date) {
          await this.prisma.recurringinvoices.update({ where: { id: r.id }, data: { is_active: false } });
          continue;
        }
        if (r.max_occurrences != null && (r.generated_count ?? 0) >= r.max_occurrences) {
          await this.prisma.recurringinvoices.update({ where: { id: r.id }, data: { is_active: false } });
          continue;
        }
        const created = await this.cloneInvoice(r.invoice_id);
        if (!created) continue;
        generated += 1;

        if (r.auto_send && created.customers?.email) {
          const total = num(created.total_amount) ?? 0;
          const paid = num(created.amount_paid) ?? 0;
          await this.email.sendInvoiceEmail({
            to: created.customers.email,
            customerName:
              [created.customers.first_name, created.customers.last_name].filter(Boolean).join(' ') || '',
            businessName: created.businesses.business_name ?? 'your supplier',
            businessEmail: created.businesses.business_email ?? null,
            invoiceNumber: created.invoice_number ?? '',
            invoiceDate: created.invoice_date,
            dueDate: created.due_date ?? null,
            currencyCode: created.currency_code ?? 'NGN',
            totalAmount: total,
            amountPaid: paid,
            items: created.invoice_items.map((it) => {
              const unitPrice = num(it.products?.unit_price) ?? 0;
              const quantity = it.quantity ?? 0;
              const discount = it.discount != null ? Number(it.discount) : 0;
              const gross = unitPrice * quantity;
              return {
                name: it.products?.name ?? 'Item',
                quantity,
                unitPrice,
                amount: gross - (gross * discount) / 100,
              };
            }),
          });
          await this.prisma.invoices.update({ where: { id: created.id }, data: { invoice_status: 'sent' } });
        }

        const next = this.advance(r.next_invoice_date ?? now, r.frequency, r.day_of_month);
        const newCount = (r.generated_count ?? 0) + 1;
        const stop =
          (r.max_occurrences != null && newCount >= r.max_occurrences) || (r.end_date != null && next > r.end_date);
        await this.prisma.recurringinvoices.update({
          where: { id: r.id },
          data: {
            last_generated_date: now,
            next_invoice_date: next,
            generated_count: newCount,
            is_active: !stop,
          },
        });
        this.logger.log(`Generated invoice ${created.invoice_number} from recurring #${r.id}`);
      } catch (e) {
        this.logger.error(`Recurring #${r.id} generation failed: ${(e as Error).message}`);
      }
    }
    if (due.length) this.logger.log(`Recurring run complete: ${generated}/${due.length} generated`);
    return { generated };
  }
}
