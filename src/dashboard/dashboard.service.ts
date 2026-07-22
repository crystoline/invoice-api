import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';

const n = (d: Prisma.Decimal | null): number => (d != null ? Number(d) : 0);
const pad = (x: number): string => String(x).padStart(2, '0');
const monthKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const round1 = (x: number): number => Math.round(x * 10) / 10;
// Percentage change of `cur` vs `prev`; divide-by-zero guarded to 0, rounded to 1dp.
const pctChange = (cur: number, prev: number): number => (prev === 0 ? 0 : round1(((cur - prev) / prev) * 100));

type ActivityItem = { type: string; title: string; amount: number; currency: string | null; at: string };
type CashflowBucket = { bucket: string; income: number; expenses: number };

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(businessId: bigint, currency?: string): Promise<ResponseObject> {
    try {
      const business = await this.prisma.businesses.findUnique({ where: { id: businessId } });
      const defaultCurrency = business?.default_currency || 'NGN';
      const [allInvoices, allBills, allIncome] = await Promise.all([
        this.prisma.invoices.findMany({ where: { business_id: businessId }, include: { customers: true } }),
        this.prisma.bills.findMany({ where: { business_id: businessId }, include: { expense_categories: true } }),
        this.prisma.income.findMany({ where: { business_id: businessId } }),
      ]);
      const effective = currency || defaultCurrency;
      const currencies = Array.from(
        new Set([defaultCurrency, ...allInvoices.map((i) => i.currency_code).filter((c): c is string => !!c)]),
      );
      // Invoices carry a currency; income & bills do not — attribute those to the
      // default currency, so they only count in the default-currency view.
      const invoices = allInvoices.filter((i) => (i.currency_code || defaultCurrency) === effective);
      const bills = effective === defaultCurrency ? allBills : [];
      const income = effective === defaultCurrency ? allIncome : [];
      const now = new Date();

      let totalInvoiced = 0;
      let totalCollected = 0;
      let outstanding = 0;
      let overdue = 0;
      for (const i of invoices) {
        const tot = n(i.total_amount);
        const paid = n(i.amount_paid);
        totalInvoiced += tot;
        totalCollected += paid;
        if (!i.is_paid) {
          outstanding += tot - paid;
          if (i.due_date && i.due_date < now) overdue += tot - paid;
        }
      }
      const totalIncome = income.reduce((s, x) => s + n(x.amount), 0);
      const totalExpenses = bills.reduce((s, x) => s + n(x.total_amount), 0);

      const byMonth: Record<string, number> = {};
      for (const i of invoices) {
        if (i.is_paid && i.invoice_date) byMonth[monthKey(new Date(i.invoice_date))] = (byMonth[monthKey(new Date(i.invoice_date))] || 0) + n(i.total_amount);
      }
      for (const x of income) {
        if (x.income_date) byMonth[monthKey(new Date(x.income_date))] = (byMonth[monthKey(new Date(x.income_date))] || 0) + n(x.amount);
      }
      const monthlyRevenue: { month: string; amount: number }[] = [];
      for (let m = 11; m >= 0; m--) {
        const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
        const k = monthKey(d);
        monthlyRevenue.push({ month: k, amount: byMonth[k] || 0 });
      }

      const catMap: Record<string, number> = {};
      for (const b of bills) {
        const name = b.expense_categories?.name || 'Uncategorized';
        catMap[name] = (catMap[name] || 0) + n(b.total_amount);
      }
      const expenseByCategory = Object.entries(catMap).map(([category, amount]) => ({ category, amount }));

      const custMap: Record<string, number> = {};
      for (const i of invoices) {
        const c = i.customers;
        const name = c ? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unknown' : 'Unknown';
        custMap[name] = (custMap[name] || 0) + n(i.total_amount);
      }
      const topCustomers = Object.entries(custMap)
        .map(([name, total]) => ({ name, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      // --- Redesigned analytics -------------------------------------------------
      // Per-month metric maps used for deltas (cur vs prev month) and sparklines.
      const bump = (map: Record<string, number>, key: string, val: number) => {
        map[key] = (map[key] || 0) + val;
      };
      // paidByMonth: invoice payments (amount_paid) bucketed by paid_date (fallback invoice_date).
      const paidByMonth: Record<string, number> = {};
      for (const i of invoices) {
        const paid = n(i.amount_paid);
        if (paid === 0) continue;
        const d = i.paid_date ?? i.invoice_date;
        if (d) bump(paidByMonth, monthKey(new Date(d)), paid);
      }
      // revenueByMonth: collected (invoice payments) + income = the top-level totalRevenue, over time.
      const revenueByMonth: Record<string, number> = { ...paidByMonth };
      for (const x of income) {
        if (x.income_date) bump(revenueByMonth, monthKey(new Date(x.income_date)), n(x.amount));
      }
      // outstandingByMonth: unpaid balance created that month, bucketed by invoice_date.
      const outstandingByMonth: Record<string, number> = {};
      for (const i of invoices) {
        if (!i.is_paid && i.invoice_date) bump(outstandingByMonth, monthKey(new Date(i.invoice_date)), n(i.total_amount) - n(i.amount_paid));
      }
      // clientsByMonth: distinct customers with an invoice that month, bucketed by invoice_date.
      const clientsByMonth: Record<string, Set<string>> = {};
      for (const i of invoices) {
        if (i.invoice_date) {
          const k = monthKey(new Date(i.invoice_date));
          (clientsByMonth[k] ??= new Set<string>()).add(String(i.customer_id));
        }
      }

      const months8: string[] = [];
      for (let m = 7; m >= 0; m--) months8.push(monthKey(new Date(now.getFullYear(), now.getMonth() - m, 1)));
      const curKey = monthKey(now);
      const prevKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));

      const paidThisMonth = paidByMonth[curKey] || 0;
      const activeClients = new Set(invoices.map((i) => String(i.customer_id))).size;

      const deltas = {
        totalRevenue: pctChange(revenueByMonth[curKey] || 0, revenueByMonth[prevKey] || 0),
        outstanding: pctChange(outstandingByMonth[curKey] || 0, outstandingByMonth[prevKey] || 0),
        paidThisMonth: pctChange(paidByMonth[curKey] || 0, paidByMonth[prevKey] || 0),
        activeClients: pctChange(clientsByMonth[curKey]?.size || 0, clientsByMonth[prevKey]?.size || 0),
      };

      const sparklines = {
        totalRevenue: months8.map((k) => revenueByMonth[k] || 0),
        outstanding: months8.map((k) => outstandingByMonth[k] || 0),
        paidThisMonth: months8.map((k) => paidByMonth[k] || 0),
        activeClients: months8.map((k) => clientsByMonth[k]?.size || 0),
      };

      let statusPaid = 0;
      let statusPending = 0;
      let statusOverdue = 0;
      for (const i of invoices) {
        const tot = n(i.total_amount);
        if (i.is_paid) statusPaid += tot;
        else if (i.due_date && i.due_date < now) statusOverdue += tot;
        else statusPending += tot;
      }
      const revenueByStatus = { paid: statusPaid, pending: statusPending, overdue: statusOverdue };

      return ok('Dashboard stats fetched successfully', {
        totalInvoiced,
        totalCollected,
        outstanding,
        overdue,
        totalIncome,
        totalExpenses,
        totalRevenue: totalCollected + totalIncome,
        netProfit: totalCollected + totalIncome - totalExpenses,
        invoiceCount: invoices.length,
        unpaidCount: invoices.filter((i) => !i.is_paid).length,
        monthlyRevenue,
        expenseByCategory,
        topCustomers,
        paidThisMonth,
        activeClients,
        deltas,
        sparklines,
        revenueByStatus,
        currency: effective,
        defaultCurrency,
        currencies,
      });
    } catch (e) {
      return fail(`Failed to fetch dashboard stats: ${(e as Error).message}`);
    }
  }

  async getCashflow(businessId: bigint, range: string, currency?: string): Promise<ResponseObject> {
    try {
      const r = range === '30d' || range === '12m' ? range : '7m';
      const now = new Date();

      const business = await this.prisma.businesses.findUnique({ where: { id: businessId } });
      const defaultCurrency = business?.default_currency || 'NGN';
      const effective = currency || defaultCurrency;
      const [allInvoices, allIncome, allBills] = await Promise.all([
        this.prisma.invoices.findMany({ where: { business_id: businessId } }),
        this.prisma.income.findMany({ where: { business_id: businessId } }),
        this.prisma.bills.findMany({ where: { business_id: businessId } }),
      ]);
      const invoices = allInvoices.filter((i) => (i.currency_code || defaultCurrency) === effective);
      const income = effective === defaultCurrency ? allIncome : [];
      const bills = effective === defaultCurrency ? allBills : [];

      const series: CashflowBucket[] = [];
      const idx: Record<string, number> = {};
      const daily = r === '30d';
      const keyOf = (d: Date): string => (daily ? dayKey(d) : monthKey(d));

      if (daily) {
        for (let i = 29; i >= 0; i--) {
          const k = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
          idx[k] = series.length;
          series.push({ bucket: k, income: 0, expenses: 0 });
        }
      } else {
        const count = r === '12m' ? 12 : 7;
        for (let m = count - 1; m >= 0; m--) {
          const k = monthKey(new Date(now.getFullYear(), now.getMonth() - m, 1));
          idx[k] = series.length;
          series.push({ bucket: k, income: 0, expenses: 0 });
        }
      }

      const addTo = (field: 'income' | 'expenses', date: Date | null, amt: number) => {
        if (!date) return;
        const b = idx[keyOf(new Date(date))];
        if (b !== undefined) series[b][field] += amt;
      };

      // income = paid invoices' total_amount (by invoice_date) + income.amount (by income_date)
      for (const i of invoices) if (i.is_paid && i.invoice_date) addTo('income', i.invoice_date, n(i.total_amount));
      for (const x of income) addTo('income', x.income_date, n(x.amount));
      // expenses = bills.total_amount (by created_at)
      for (const b of bills) addTo('expenses', b.created_at, n(b.total_amount));

      return ok('Cashflow fetched successfully', { range: r, series });
    } catch (e) {
      return fail(`Failed to fetch cashflow: ${(e as Error).message}`);
    }
  }

  async getActivity(businessId: bigint): Promise<ResponseObject> {
    try {
      const [invoices, payments, bills] = await Promise.all([
        this.prisma.invoices.findMany({ where: { business_id: businessId } }),
        this.prisma.payments.findMany({ where: { business_id: businessId } }),
        this.prisma.bills.findMany({ where: { business_id: businessId } }),
      ]);

      const events: ActivityItem[] = [];
      const label = (num: string | null, id: bigint): string => num ?? `#${id}`;

      for (const i of invoices) {
        const cur = i.currency_code ?? null;
        const name = label(i.invoice_number, i.id);
        if (i.invoice_date) events.push({ type: 'invoice_created', title: `Invoice ${name} created`, amount: n(i.total_amount), currency: cur, at: new Date(i.invoice_date).toISOString() });
        if ((i.invoice_status ?? '').toLowerCase() === 'sent' && i.invoice_date) events.push({ type: 'invoice_sent', title: `Invoice ${name} sent`, amount: n(i.total_amount), currency: cur, at: new Date(i.invoice_date).toISOString() });
        if (i.is_paid && i.paid_date) events.push({ type: 'invoice_paid', title: `Invoice ${name} paid`, amount: n(i.amount_paid), currency: cur, at: new Date(i.paid_date).toISOString() });
      }
      for (const p of payments) {
        const at = p.paid_at ?? p.created_at;
        if (at) events.push({ type: 'payment_received', title: 'Payment received', amount: n(p.amount), currency: p.currency ?? null, at: new Date(at).toISOString() });
      }
      for (const b of bills) {
        if (b.created_at) events.push({ type: 'bill_added', title: `Bill ${label(b.bill_number, b.id)} added`, amount: n(b.total_amount), currency: null, at: new Date(b.created_at).toISOString() });
      }

      events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      return ok('Activity fetched successfully', events.slice(0, 15));
    } catch (e) {
      return fail(`Failed to fetch activity: ${(e as Error).message}`);
    }
  }
}
