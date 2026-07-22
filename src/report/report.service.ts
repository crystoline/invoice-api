import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { ReportQueryDto } from './dto/report-query.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Decimal | null → number (missing/NULL sums become 0, never null). */
const num = (d: Prisma.Decimal | null | undefined): number => (d != null ? Number(d) : 0);
/** Trim binary-float noise from summed money to 2dp. */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
/** Date → 'YYYY-MM-DD' (UTC). */
const ymd = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
/** Date → 'YYYY-MM' bucket key (UTC). */
const monthKey = (d: Date | null | undefined): string | null =>
  d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` : null;
const isCsv = (format?: string): boolean => (format ?? '').toLowerCase() === 'csv';
/** RFC-4180-ish escaping so category names containing commas stay one column. */
const csvCell = (v: string | number | null | undefined): string => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const startOfUtcDay = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

type DateRange = { gte?: Date; lte?: Date };

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  // ── shared guards / helpers ────────────────────────────────────────────────

  /** Parse the `businessId` query param into a positive BigInt, else null. */
  private parseBusinessId(raw?: string): bigint | null {
    if (raw == null || raw.trim() === '') return null;
    try {
      const id = BigInt(raw.trim());
      return id > 0n ? id : null;
    } catch {
      return null;
    }
  }

  /**
   * Owner-tenancy guard (mirrors the rest of the app): the business must exist
   * and be owned by the caller — or the caller must be an admin. Returns a
   * `fail()` envelope to short-circuit on, or null when access is granted.
   */
  private async assertBusinessAccess(businessId: bigint, user: AuthUser): Promise<ResponseObject | null> {
    const business = await this.prisma.businesses.findUnique({ where: { id: businessId } });
    if (!business) return fail('Business not found');
    if (business.owner_id !== user.id && !user.roles.includes(Role.ADMIN)) {
      return fail('You do not have permission to view reports for this business');
    }
    return null;
  }

  /**
   * Resolve which currency a report is scoped to. Invoices carry a
   * `currency_code`; income and bills do not. The business `default_currency`
   * is the effective currency when none is requested. Legacy invoices with a
   * NULL `currency_code` are treated as the default currency, so the default
   * view still includes them.
   */
  private async resolveCurrency(
    businessId: bigint,
    requested?: string,
  ): Promise<{ effective: string; isDefault: boolean; defaultCurrency: string; invoiceWhere: Prisma.invoicesWhereInput }> {
    const business = await this.prisma.businesses.findUnique({
      where: { id: businessId },
      select: { default_currency: true },
    });
    const defaultCurrency = business?.default_currency || 'NGN';
    const effective = (requested && requested.trim()) || defaultCurrency;
    const isDefault = effective === defaultCurrency;
    // In the default view, also match legacy invoices with no currency recorded.
    const invoiceWhere: Prisma.invoicesWhereInput = isDefault
      ? { OR: [{ currency_code: effective }, { currency_code: null }] }
      : { currency_code: effective };
    return { effective, isDefault, defaultCurrency, invoiceWhere };
  }

  /** Build an inclusive Prisma date filter from optional ISO strings. */
  private parseRange(from?: string, to?: string): DateRange | undefined {
    const range: DateRange = {};
    if (from) {
      const d = new Date(from);
      if (!isNaN(d.getTime())) range.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!isNaN(d.getTime())) {
        // A date-only bound ('2026-07-18') parses to midnight UTC; widen it to
        // the end of that day so the upper bound is inclusive.
        if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) {
          d.setUTCHours(23, 59, 59, 999);
        }
        range.lte = d;
      }
    }
    return range.gte || range.lte ? range : undefined;
  }

  // ── GET /api/reports/revenue ───────────────────────────────────────────────

  async revenue(query: ReportQueryDto, user: AuthUser): Promise<ResponseObject> {
    try {
      const businessId = this.parseBusinessId(query.businessId);
      if (businessId == null) return fail('A valid businessId is required');
      const denied = await this.assertBusinessAccess(businessId, user);
      if (denied) return denied;

      const range = this.parseRange(query.from, query.to);
      const cur = await this.resolveCurrency(businessId, query.currency);

      const invoiceWhere: Prisma.invoicesWhereInput = { business_id: businessId, ...cur.invoiceWhere };
      if (range) invoiceWhere.invoice_date = range;
      const incomeWhere: Prisma.incomeWhereInput = { business_id: businessId };
      if (range) incomeWhere.income_date = range;

      // Income has no currency dimension → only counted in the default view.
      const [invAgg, incAgg] = await Promise.all([
        this.prisma.invoices.aggregate({ where: invoiceWhere, _sum: { total_amount: true, amount_paid: true } }),
        cur.isDefault
          ? this.prisma.income.aggregate({ where: incomeWhere, _sum: { amount: true } })
          : Promise.resolve({ _sum: { amount: null } }),
      ]);

      const totalInvoiced = round2(num(invAgg._sum.total_amount));
      const totalCollected = round2(num(invAgg._sum.amount_paid));
      const totalIncome = round2(num(incAgg._sum.amount));
      const byMonth = await this.revenueByMonth(businessId, cur.invoiceWhere, cur.isDefault);

      if (isCsv(query.format)) {
        const header = 'month,invoiced,collected,income';
        const rows = byMonth.map((m) => `${m.month},${m.invoiced},${m.collected},${m.income}`);
        const totalRow = `TOTAL,${totalInvoiced},${totalCollected},${totalIncome}`;
        return ok('Revenue report generated', { csv: [header, ...rows, totalRow].join('\n') });
      }

      return ok('Revenue report generated', {
        businessId,
        currency: cur.effective,
        defaultCurrency: cur.defaultCurrency,
        from: ymd(range?.gte),
        to: ymd(range?.lte),
        totalInvoiced,
        totalCollected,
        totalIncome,
        byMonth,
      });
    } catch (e) {
      return fail(`Failed to generate revenue report: ${(e as Error).message}`);
    }
  }

  /** Invoiced/collected/income totals for each of the last 12 calendar months. */
  private async revenueByMonth(
    businessId: bigint,
    currencyWhere: Prisma.invoicesWhereInput,
    includeIncome: boolean,
  ): Promise<Array<{ month: string; invoiced: number; collected: number; income: number }>> {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

    const months: string[] = [];
    const acc: Record<string, { invoiced: number; collected: number; income: number }> = {};
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      months.push(key);
      acc[key] = { invoiced: 0, collected: 0, income: 0 };
    }

    const [invoices, incomes] = await Promise.all([
      this.prisma.invoices.findMany({
        where: { business_id: businessId, ...currencyWhere, invoice_date: { gte: start } },
        select: { invoice_date: true, total_amount: true, amount_paid: true },
      }),
      includeIncome
        ? this.prisma.income.findMany({
            where: { business_id: businessId, income_date: { gte: start } },
            select: { income_date: true, amount: true },
          })
        : Promise.resolve([]),
    ]);

    for (const inv of invoices) {
      const key = monthKey(inv.invoice_date);
      if (key && acc[key]) {
        acc[key].invoiced += num(inv.total_amount);
        acc[key].collected += num(inv.amount_paid);
      }
    }
    for (const inc of incomes) {
      const key = monthKey(inc.income_date);
      if (key && acc[key]) acc[key].income += num(inc.amount);
    }

    return months.map((m) => ({
      month: m,
      invoiced: round2(acc[m].invoiced),
      collected: round2(acc[m].collected),
      income: round2(acc[m].income),
    }));
  }

  // ── GET /api/reports/expenses ──────────────────────────────────────────────

  async expenses(query: ReportQueryDto, user: AuthUser): Promise<ResponseObject> {
    try {
      const businessId = this.parseBusinessId(query.businessId);
      if (businessId == null) return fail('A valid businessId is required');
      const denied = await this.assertBusinessAccess(businessId, user);
      if (denied) return denied;

      const cur = await this.resolveCurrency(businessId, query.currency);
      // Bills have no currency dimension → expenses only apply to the default view.
      if (!cur.isDefault) {
        const empty = { businessId, currency: cur.effective, defaultCurrency: cur.defaultCurrency, totalBills: 0, billCount: 0, byCategory: [] };
        if (isCsv(query.format)) {
          return ok('Expenses report generated', { csv: 'categoryName,amount,count\nTOTAL,0,0' });
        }
        return ok('Expenses report generated', empty);
      }

      // bills carry no date column, so from/to do not apply here.
      const [totalAgg, grouped, categories] = await Promise.all([
        this.prisma.bills.aggregate({ where: { business_id: businessId }, _sum: { total_amount: true }, _count: true }),
        this.prisma.bills.groupBy({
          by: ['category_id'],
          where: { business_id: businessId },
          _sum: { total_amount: true },
          _count: true,
        }),
        this.prisma.expense_categories.findMany({ where: { business_id: businessId }, select: { id: true, name: true } }),
      ]);

      const nameById = new Map<string, string>();
      for (const c of categories) nameById.set(c.id.toString(), c.name);

      const totalBills = round2(num(totalAgg._sum.total_amount));
      const billCount = totalAgg._count;

      const byCategory = grouped
        .map((g) => ({
          categoryId: g.category_id,
          categoryName:
            g.category_id != null ? nameById.get(g.category_id.toString()) ?? 'Unknown' : 'Uncategorized',
          amount: round2(num(g._sum.total_amount)),
          count: g._count,
        }))
        .sort((a, b) => b.amount - a.amount);

      if (isCsv(query.format)) {
        const header = 'categoryName,amount,count';
        const rows = byCategory.map((c) => `${csvCell(c.categoryName)},${c.amount},${c.count}`);
        const totalRow = `TOTAL,${totalBills},${billCount}`;
        return ok('Expenses report generated', { csv: [header, ...rows, totalRow].join('\n') });
      }

      return ok('Expenses report generated', {
        businessId,
        currency: cur.effective,
        defaultCurrency: cur.defaultCurrency,
        totalBills,
        billCount,
        byCategory,
      });
    } catch (e) {
      return fail(`Failed to generate expenses report: ${(e as Error).message}`);
    }
  }

  // ── GET /api/reports/aging ─────────────────────────────────────────────────

  async aging(query: ReportQueryDto, user: AuthUser): Promise<ResponseObject> {
    try {
      const businessId = this.parseBusinessId(query.businessId);
      if (businessId == null) return fail('A valid businessId is required');
      const denied = await this.assertBusinessAccess(businessId, user);
      if (denied) return denied;

      const range = this.parseRange(query.from, query.to);
      const cur = await this.resolveCurrency(businessId, query.currency);
      const where: Prisma.invoicesWhereInput = { business_id: businessId, is_paid: { not: true }, ...cur.invoiceWhere };
      if (range) where.invoice_date = range;

      const invoices = await this.prisma.invoices.findMany({
        where,
        select: { total_amount: true, amount_paid: true, due_date: true, invoice_date: true },
      });

      const buckets = {
        current: { label: 'current', count: 0, amount: 0 },
        '1-30': { label: '1-30', count: 0, amount: 0 },
        '31-60': { label: '31-60', count: 0, amount: 0 },
        '61-90': { label: '61-90', count: 0, amount: 0 },
        '90+': { label: '90+', count: 0, amount: 0 },
      };
      const today = startOfUtcDay(new Date()).getTime();

      for (const inv of invoices) {
        const outstanding = num(inv.total_amount) - num(inv.amount_paid);
        if (outstanding <= 0) continue; // nothing owed → not in the aging report
        const ref = inv.due_date ?? inv.invoice_date;
        const daysOverdue = ref ? Math.floor((today - startOfUtcDay(ref).getTime()) / DAY_MS) : 0;

        let key: keyof typeof buckets;
        if (daysOverdue <= 0) key = 'current';
        else if (daysOverdue <= 30) key = '1-30';
        else if (daysOverdue <= 60) key = '31-60';
        else if (daysOverdue <= 90) key = '61-90';
        else key = '90+';

        buckets[key].count += 1;
        buckets[key].amount += outstanding;
      }

      const bucketList = Object.values(buckets).map((b) => ({ ...b, amount: round2(b.amount) }));
      const totalOutstanding = round2(bucketList.reduce((s, b) => s + b.amount, 0));

      if (isCsv(query.format)) {
        const header = 'bucket,count,amount';
        const rows = bucketList.map((b) => `${b.label},${b.count},${b.amount}`);
        const totalRow = `TOTAL,,${totalOutstanding}`;
        return ok('Aging report generated', { csv: [header, ...rows, totalRow].join('\n') });
      }

      return ok('Aging report generated', {
        businessId,
        currency: cur.effective,
        defaultCurrency: cur.defaultCurrency,
        totalOutstanding,
        buckets: bucketList,
      });
    } catch (e) {
      return fail(`Failed to generate aging report: ${(e as Error).message}`);
    }
  }

  // ── GET /api/reports/tax-summary ───────────────────────────────────────────

  async taxSummary(query: ReportQueryDto, user: AuthUser): Promise<ResponseObject> {
    try {
      const businessId = this.parseBusinessId(query.businessId);
      if (businessId == null) return fail('A valid businessId is required');
      const denied = await this.assertBusinessAccess(businessId, user);
      if (denied) return denied;

      const range = this.parseRange(query.from, query.to);
      const cur = await this.resolveCurrency(businessId, query.currency);
      const where: Prisma.invoicesWhereInput = { business_id: businessId, ...cur.invoiceWhere };
      if (range) where.invoice_date = range;

      const agg = await this.prisma.invoices.aggregate({ where, _sum: { total_amount: true }, _count: true });
      const taxableTotal = round2(num(agg._sum.total_amount));
      const note =
        'Per-line tax is not modelled yet. taxableTotal is the gross invoiced total for the selected range; taxCollected is 0 until tax lines are added to invoices.';

      if (isCsv(query.format)) {
        const header = 'metric,value';
        const rows = [
          `invoiceCount,${agg._count}`,
          `taxableTotal,${taxableTotal}`,
          `taxCollected,0`,
          `note,${csvCell(note)}`,
        ];
        return ok('Tax summary report generated', { csv: [header, ...rows].join('\n') });
      }

      return ok('Tax summary report generated', {
        businessId,
        currency: cur.effective,
        defaultCurrency: cur.defaultCurrency,
        from: ymd(range?.gte),
        to: ymd(range?.lte),
        invoiceCount: agg._count,
        taxableTotal,
        taxCollected: 0,
        note,
      });
    } catch (e) {
      return fail(`Failed to generate tax summary report: ${(e as Error).message}`);
    }
  }
}
