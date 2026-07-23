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

/** Shape passed to the PDF templates (built by the invoice service). */
export interface InvoicePdfModel {
  invoiceNumber: string | null;
  customer: { id: bigint | number | null };
  invoiceDate: Date | null;
  invoiceStatus: string | null;
  isPaid: boolean | null;
  totalAmount: number | null;
  currencyCode: string | null;
  items: { product: { name: string | null; unitPrice: number | null }; quantity: number }[];
}

Handlebars.registerHelper('formatDate', (date: Date | null) => {
  if (!date) return '';
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
});

// Mode A — plain document mirroring the iText raw output.
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

// Mode B — the styled template (with the corrected field paths so it renders).
const DEFAULT_TEMPLATE = Handlebars.compile(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice</title>
<style>
  body { font-family: Arial, sans-serif; margin: 20px; }
  .invoice-header { text-align: center; margin-bottom: 20px; }
  .invoice-header h1 { color: #4CAF50; }
  .invoice-details { margin-bottom: 20px; }
  .invoice-details table, .invoice-items table { width: 100%; border-collapse: collapse; }
  .invoice-details th, .invoice-details td,
  .invoice-items th, .invoice-items td { border: 1px solid #ddd; padding: 8px; }
  .invoice-details th, .invoice-items th { background-color: #f2f2f2; text-align: left; }
  .invoice-items { margin-bottom: 20px; }
  .invoice-total { text-align: right; font-size: 18px; font-weight: bold; }
</style></head><body>
  <div class="invoice-header"><h1>Invoice</h1></div>
  <div class="invoice-details"><table>
    <tr><th>Invoice Number</th><td>{{invoice.invoiceNumber}}</td></tr>
    <tr><th>Customer ID</th><td>{{invoice.customer.id}}</td></tr>
    <tr><th>Invoice Date</th><td>{{formatDate invoice.invoiceDate}}</td></tr>
    <tr><th>Status</th><td>{{invoice.invoiceStatus}}</td></tr>
    <tr><th>Is Paid</th><td>{{#if invoice.isPaid}}Yes{{else}}No{{/if}}</td></tr>
  </table></div>
  <div class="invoice-items"><table>
    <thead><tr><th>Item</th><th>Quantity</th><th>Price</th></tr></thead>
    <tbody>
      {{#each invoice.items}}
      <tr><td>{{this.product.name}}</td><td>{{this.quantity}}</td><td>{{this.product.unitPrice}}</td></tr>
      {{/each}}
    </tbody>
  </table></div>
  <div class="invoice-total"><p>Total Amount: <span>{{invoice.totalAmount}} {{invoice.currencyCode}}</span></p></div>
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
