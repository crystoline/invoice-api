import { Injectable, Logger } from '@nestjs/common';
import * as Handlebars from 'handlebars';
import type { Browser, Viewport } from 'puppeteer-core';

// @sparticuz/chromium's default-export types resolve to the class, not the
// runtime object, so defaultViewport/headless aren't visible. This is the
// actual shape we consume.
interface ServerlessChromium {
  args: string[];
  defaultViewport: Viewport | null;
  headless: boolean | 'shell';
  executablePath(): Promise<string>;
  setGraphicsMode: boolean;
}

/** One rendered line on the invoice. Amounts are precomputed by the caller. */
export interface InvoicePdfItem {
  product: { name: string | null; unitPrice: number | null };
  quantity: number;
  /** Percentage, 0–100. */
  discount?: number;
  /** unitPrice × quantity, before discount. */
  gross?: number;
  /** Line total after discount. */
  amount?: number;
}

/** Shape passed to the PDF templates (built by the invoice service). */
export interface InvoicePdfModel {
  invoiceNumber: string | null;
  customer: {
    id: bigint | number | null;
    name?: string | null;
    email?: string | null;
    address?: string | null;
  };
  business?: {
    name?: string | null;
    email?: string | null;
    address?: string | null;
    phone?: string | null;
    taxId?: string | null;
    paymentTermsDays?: number | null;
  };
  invoiceDate: Date | null;
  dueDate?: Date | null;
  invoiceStatus: string | null;
  isPaid: boolean | null;
  totalAmount: number | null;
  amountPaid?: number | null;
  /** totalAmount − amountPaid, floored at 0. */
  balanceDue?: number | null;
  subtotal?: number | null;
  discountTotal?: number | null;
  currencyCode: string | null;
  items: InvoicePdfItem[];
}

Handlebars.registerHelper('formatDate', (date: Date | null) => {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
});

Handlebars.registerHelper('money', (amount: unknown, currency: unknown) => {
  const value = Number(amount) || 0;
  const code = String(currency || 'NGN').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${code} ${value.toFixed(2)}`;
  }
});

// Mode A — plain document mirroring the legacy iText raw output. Deliberately
// unstyled; the designed document is DEFAULT_TEMPLATE below.
const RAW_TEMPLATE = Handlebars.compile(`<html><body style="font-family:Arial, sans-serif; margin:20px;">
<p>Invoice Details</p>
<p>Invoice Number: {{invoice.invoiceNumber}}</p>
<p>Customer ID: {{invoice.customer.id}}</p>
<p>Invoice Date: {{formatDate invoice.invoiceDate}}</p>
<p>Total Amount: {{invoice.totalAmount}} {{invoice.currencyCode}}</p>
<p>Status: {{invoice.invoiceStatus}}</p>
<p>Is Paid: {{#if invoice.isPaid}}Yes{{else}}No{{/if}}</p>
<p>&nbsp;</p>
<p>Invoice Items:</p>
{{#each invoice.items}}
<p>Item: {{this.product.name}}, Quantity: {{this.quantity}}, Price: {{this.product.unitPrice}}</p>
{{/each}}
</body></html>`);

// Mode B — the designed invoice document.
const DEFAULT_TEMPLATE = Handlebars.compile(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice {{invoice.invoiceNumber}}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    margin: 0; padding: 40px 44px; color: #111827; font-size: 13px; line-height: 1.55;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .biz-name { font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 6px; }
  .muted { color: #6b7280; }
  .doc-title { font-size: 30px; font-weight: 800; letter-spacing: 1.5px; color: #2563eb; margin: 0; text-align: right; }
  .doc-no { text-align: right; font-size: 13px; color: #6b7280; margin-top: 2px; }
  .badge {
    display: inline-block; margin-top: 8px; padding: 4px 12px; border-radius: 999px;
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px;
  }
  .badge-paid { background: #e6f7ee; color: #12965a; }
  .badge-due  { background: #fff1e2; color: #c9720b; }
  .rule { height: 2px; background: #2563eb; margin: 18px 0 22px; border-radius: 2px; }
  .cols { display: flex; gap: 28px; margin-bottom: 26px; }
  .col { flex: 1; }
  .label { font-size: 10px; text-transform: uppercase; letter-spacing: .7px; color: #6b7280; margin-bottom: 5px; font-weight: 700; }
  .party-name { font-weight: 600; font-size: 14px; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  table.items thead th {
    background: #f3f4f6; font-size: 10px; text-transform: uppercase; letter-spacing: .6px;
    color: #374151; padding: 9px 10px; text-align: left; border-bottom: 2px solid #e5e7eb;
  }
  table.items tbody td { padding: 9px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  table.items tbody tr:nth-child(even) td { background: #fbfbfd; }
  .r { text-align: right; }
  .c { text-align: center; }
  .totals { width: 260px; margin-left: auto; border-collapse: collapse; }
  .totals td { padding: 6px 10px; }
  .totals .t-label { color: #6b7280; text-align: right; }
  .totals .t-val { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .totals tr.grand td { border-top: 2px solid #e5e7eb; padding-top: 10px; font-size: 15px; font-weight: 700; color: #111827; }
  .foot { margin-top: 34px; padding-top: 14px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 11.5px; }
  .empty { padding: 18px 10px; color: #6b7280; }
</style></head><body>

  <div class="top">
    <div>
      <p class="biz-name">{{#if invoice.business.name}}{{invoice.business.name}}{{else}}Invoice{{/if}}</p>
      <div class="muted">
        {{#if invoice.business.address}}<div>{{invoice.business.address}}</div>{{/if}}
        {{#if invoice.business.email}}<div>{{invoice.business.email}}</div>{{/if}}
        {{#if invoice.business.phone}}<div>{{invoice.business.phone}}</div>{{/if}}
        {{#if invoice.business.taxId}}<div>Tax ID: {{invoice.business.taxId}}</div>{{/if}}
      </div>
    </div>
    <div>
      <p class="doc-title">INVOICE</p>
      <div class="doc-no">{{invoice.invoiceNumber}}</div>
      <div style="text-align:right">
        {{#if invoice.isPaid}}<span class="badge badge-paid">Paid</span>
        {{else}}<span class="badge badge-due">Balance due</span>{{/if}}
      </div>
    </div>
  </div>

  <div class="rule"></div>

  <div class="cols">
    <div class="col">
      <div class="label">Billed to</div>
      <div class="party-name">{{#if invoice.customer.name}}{{invoice.customer.name}}{{else}}Customer #{{invoice.customer.id}}{{/if}}</div>
      <div class="muted">
        {{#if invoice.customer.email}}<div>{{invoice.customer.email}}</div>{{/if}}
        {{#if invoice.customer.address}}<div>{{invoice.customer.address}}</div>{{/if}}
      </div>
    </div>
    <div class="col">
      <div class="label">Issued</div>
      <div>{{formatDate invoice.invoiceDate}}</div>
    </div>
    <div class="col">
      <div class="label">Due</div>
      <div>{{formatDate invoice.dueDate}}</div>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th style="width:46%">Description</th>
        <th class="c" style="width:10%">Qty</th>
        <th class="r" style="width:18%">Unit price</th>
        <th class="c" style="width:10%">Disc</th>
        <th class="r" style="width:16%">Amount</th>
      </tr>
    </thead>
    <tbody>
      {{#each invoice.items}}
      <tr>
        <td>{{#if this.product.name}}{{this.product.name}}{{else}}Item{{/if}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="r">{{money this.product.unitPrice ../invoice.currencyCode}}</td>
        <td class="c">{{#if this.discount}}{{this.discount}}%{{else}}—{{/if}}</td>
        <td class="r">{{money this.amount ../invoice.currencyCode}}</td>
      </tr>
      {{else}}
      <tr><td colspan="5" class="empty">No line items on this invoice.</td></tr>
      {{/each}}
    </tbody>
  </table>

  <table class="totals">
    <tr>
      <td class="t-label">Subtotal</td>
      <td class="t-val">{{money invoice.subtotal invoice.currencyCode}}</td>
    </tr>
    {{#if invoice.discountTotal}}
    <tr>
      <td class="t-label">Discount</td>
      <td class="t-val">- {{money invoice.discountTotal invoice.currencyCode}}</td>
    </tr>
    {{/if}}
    <tr>
      <td class="t-label">Total</td>
      <td class="t-val">{{money invoice.totalAmount invoice.currencyCode}}</td>
    </tr>
    {{#if invoice.amountPaid}}
    <tr>
      <td class="t-label">Paid</td>
      <td class="t-val">- {{money invoice.amountPaid invoice.currencyCode}}</td>
    </tr>
    {{/if}}
    <tr class="grand">
      <td class="t-label" style="color:#111827">Balance due</td>
      <td class="t-val">{{money invoice.balanceDue invoice.currencyCode}}</td>
    </tr>
  </table>

  <div class="foot">
    {{#if invoice.business.paymentTermsDays}}Payment is due within {{invoice.business.paymentTermsDays}} days of the issue date. {{/if}}
    Thank you for your business.
  </div>

</body></html>`);

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  async generateRawPdf(invoice: InvoicePdfModel): Promise<Buffer> {
    return this.render(RAW_TEMPLATE({ invoice }));
  }

  async generateDefaultTemplatePdf(invoice: InvoicePdfModel): Promise<Buffer> {
    return this.render(DEFAULT_TEMPLATE({ invoice }));
  }

  /**
   * Launch a Chromium suited to the runtime.
   *
   * - Serverless (Vercel/Lambda): puppeteer-core + @sparticuz/chromium, which
   *   ships a Chromium binary that actually runs in that sandbox. The full
   *   `puppeteer` package's bundled Chromium does NOT (hence ERR_REQUIRE_ESM
   *   was only the first wall).
   * - Local/dev: the full `puppeteer` (a devDependency). Loaded via a computed
   *   specifier so Vercel's file tracer can't pull that heavy dep into the
   *   function bundle. Both imports are dynamic — puppeteer 25 is ESM-only, so
   *   a static (compiled to require()) import throws ERR_REQUIRE_ESM.
   */
  private async launchBrowser(): Promise<Browser> {
    const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_VERSION;
    if (isServerless) {
      const chromium = (await import('@sparticuz/chromium')).default as unknown as ServerlessChromium;
      const puppeteer = (await import('puppeteer-core')).default;
      chromium.setGraphicsMode = false; // no WebGL needed for invoices — saves memory
      return puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });
    }
    const specifier = 'puppeteer';
    const puppeteer = (await import(specifier)).default;
    return puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  private async render(html: string): Promise<Buffer> {
    const browser = await this.launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      return Buffer.from(await page.pdf({ format: 'A4', printBackground: true }));
    } catch (err) {
      this.logger.error(`PDF render failed: ${(err as Error).message}`);
      throw err;
    } finally {
      await browser.close();
    }
  }
}
