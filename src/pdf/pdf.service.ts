import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';

/** One rendered line on the invoice. Amounts are precomputed by the caller. */
export interface InvoicePdfItem {
  product: { name: string | null; unitPrice: number | null };
  quantity: number;
  /** Percentage, 0-100. */
  discount?: number;
  /** unitPrice x quantity, before discount. */
  gross?: number;
  /** Line total after discount. */
  amount?: number;
}

/** Shape passed to the PDF renderer (built by the invoice service). */
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
  /** totalAmount - amountPaid, floored at 0. */
  balanceDue?: number | null;
  subtotal?: number | null;
  discountTotal?: number | null;
  currencyCode: string | null;
  /** Free text shown under the totals; line breaks are kept. */
  notes?: string | null;
  additionalInfo?: string | null;
  items: InvoicePdfItem[];
}

// ---- page geometry (A4 = 595.28 x 841.89pt) --------------------------------
const MARGIN = 50;
const LEFT = MARGIN;
const RIGHT = 545; // 595.28 - MARGIN, rounded to a whole point
const CONTENT_W = RIGHT - LEFT;

const COL = {
  desc: { x: LEFT, w: 205 },
  qty: { x: 258, w: 40 },
  price: { x: 300, w: 90 },
  disc: { x: 394, w: 38 },
  amount: { x: 436, w: 109 },
};

const BRAND = '#2563eb';
const TEXT = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const ZEBRA = '#fbfbfd';
const HEAD_BG = '#f3f4f6';

const BODY = 'Helvetica';
const BOLD = 'Helvetica-Bold';

/**
 * Strip anything the built-in PDF fonts cannot encode.
 *
 * PDFKit's standard fonts are WinAnsi (Latin-1). Smart quotes and dashes are
 * folded to ASCII; anything else outside Latin-1 (emoji, CJK) is dropped rather
 * than rendered as garbage. Embedding a Unicode TTF would avoid this, at the
 * cost of shipping a font file - not worth it for invoice text.
 */
const safe = (v: string | number | bigint | null | undefined): string =>
  String(v ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[\r\n\t]+/g, ' ')
    // Keep printable ASCII plus the Latin-1 supplement; drop everything else.
    .replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, '')
    .trim();

/** `safe`, but line by line, so multi-line notes keep the author's breaks. */
const safeBlock = (v: string | null | undefined): string =>
  String(v ?? '')
    .split(/\r?\n/)
    .map(safe)
    .join('\n')
    .trim();

/**
 * Money as `NGN 1,000.00`.
 *
 * Deliberately the ISO code, not the symbol: the naira sign has no WinAnsi
 * glyph, so a symbol-formatted total would silently lose its currency marker.
 */
const money = (
  amount: number | null | undefined,
  currency: string | null | undefined,
): string => {
  const value = Number(amount) || 0;
  const code = String(currency || 'NGN').toUpperCase();
  try {
    return (
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        currencyDisplay: 'code',
        minimumFractionDigits: 2,
      })
        .format(value)
        // Intl separates the code with a non-breaking space; normalise it.
        .replace(/\u00A0/g, ' ')
    );
  } catch {
    return `${code} ${value.toFixed(2)}`;
  }
};

const formatDate = (d: Date | null | undefined): string => {
  if (!d) return '-';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

type Doc = PDFKit.PDFDocument;

/**
 * Invoice PDF generation, rendered directly with PDFKit.
 *
 * This used to drive headless Chromium via puppeteer, which does not survive
 * serverless well: an ESM-only package that bundlers rewrite into require(), a
 * ~170MB browser download, ~1.5GB of memory and seconds of cold start. PDFKit
 * draws the document in-process - no binary, no browser, no ESM landmines.
 */
@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  /** Mode A - plain text document, mirroring the legacy iText raw output. */
  async generateRawPdf(invoice: InvoicePdfModel): Promise<Buffer> {
    return this.render((doc) => {
      doc.font(BODY).fontSize(11).fillColor(TEXT);
      const line = (t: string) => doc.text(safe(t), { width: CONTENT_W });
      line('Invoice Details');
      line(`Invoice Number: ${invoice.invoiceNumber ?? ''}`);
      line(`Customer ID: ${invoice.customer?.id ?? ''}`);
      line(`Invoice Date: ${formatDate(invoice.invoiceDate)}`);
      line(`Due Date: ${formatDate(invoice.dueDate)}`);
      line(
        `Total Amount: ${invoice.totalAmount ?? 0} ${invoice.currencyCode ?? ''}`,
      );
      line(`Status: ${invoice.invoiceStatus ?? ''}`);
      line(`Is Paid: ${invoice.isPaid ? 'Yes' : 'No'}`);
      doc.moveDown();
      line('Invoice Items:');
      for (const it of invoice.items ?? []) {
        line(
          `Item: ${it.product?.name ?? ''}, Quantity: ${it.quantity}, Price: ${it.product?.unitPrice ?? ''}`,
        );
      }
      for (const [title, body] of [
        ['Notes', invoice.notes],
        ['Additional Information', invoice.additionalInfo],
      ] as const) {
        const text = safeBlock(body);
        if (!text) continue;
        doc.moveDown();
        line(`${title}:`);
        doc.text(text, { width: CONTENT_W });
      }
    });
  }

  /** Mode B - the designed invoice document. */
  async generateDefaultTemplatePdf(invoice: InvoicePdfModel): Promise<Buffer> {
    return this.render((doc) => this.drawInvoice(doc, invoice));
  }

  // ---- drawing -------------------------------------------------------------

  private drawInvoice(doc: Doc, inv: InvoicePdfModel): void {
    const currency = inv.currencyCode ?? 'NGN';
    let y = MARGIN;

    // --- header: business block (left) / INVOICE + number + badge (right) ---
    doc.font(BOLD).fontSize(18).fillColor(TEXT);
    doc.text(safe(inv.business?.name) || 'Invoice', LEFT, y, { width: 300 });
    let leftY = doc.y + 2;
    doc.font(BODY).fontSize(9).fillColor(MUTED);
    for (const detail of [
      inv.business?.address,
      inv.business?.email,
      inv.business?.phone,
      inv.business?.taxId ? `Tax ID: ${inv.business.taxId}` : null,
    ]) {
      if (!detail) continue;
      doc.text(safe(detail), LEFT, leftY, { width: 280 });
      leftY = doc.y;
    }

    doc.font(BOLD).fontSize(24).fillColor(BRAND);
    doc.text('INVOICE', LEFT, y, { width: CONTENT_W, align: 'right' });
    let rightY = doc.y + 1;
    doc.font(BODY).fontSize(10).fillColor(MUTED);
    doc.text(safe(inv.invoiceNumber), LEFT, rightY, {
      width: CONTENT_W,
      align: 'right',
    });
    rightY = doc.y + 6;
    this.drawBadge(
      doc,
      inv.isPaid ? 'PAID' : 'BALANCE DUE',
      rightY,
      !!inv.isPaid,
    );

    y = Math.max(leftY, rightY + 20) + 14;

    // --- brand rule ---
    doc.rect(LEFT, y, CONTENT_W, 2).fill(BRAND);
    y += 20;

    // --- billed to / issued / due ---
    const colW = CONTENT_W / 3;
    this.label(doc, 'BILLED TO', LEFT, y);
    this.label(doc, 'ISSUED', LEFT + colW, y);
    this.label(doc, 'DUE', LEFT + colW * 2, y);
    y += 13;

    doc.font(BOLD).fontSize(11).fillColor(TEXT);
    const customerName =
      safe(inv.customer?.name) || `Customer #${inv.customer?.id ?? ''}`;
    doc.text(customerName, LEFT, y, { width: colW - 12 });
    const afterName = doc.y;

    doc.font(BODY).fontSize(11).fillColor(TEXT);
    doc.text(formatDate(inv.invoiceDate), LEFT + colW, y, { width: colW - 12 });
    doc.text(formatDate(inv.dueDate), LEFT + colW * 2, y, { width: colW - 12 });

    let partyY = afterName;
    doc.font(BODY).fontSize(9).fillColor(MUTED);
    for (const detail of [inv.customer?.email, inv.customer?.address]) {
      if (!detail) continue;
      doc.text(safe(detail), LEFT, partyY, { width: colW - 12 });
      partyY = doc.y;
    }

    y = Math.max(partyY, y + 16) + 20;

    // --- items ---
    y = this.drawItemsHeader(doc, y);
    const items = inv.items ?? [];
    for (let i = 0; i < items.length; i++) {
      // Keep a little room so a row never lands flush against the page edge.
      if (y > doc.page.height - MARGIN - 70) {
        doc.addPage();
        y = this.drawItemsHeader(doc, MARGIN);
      }
      y = this.drawItemRow(doc, items[i], i, y, currency);
    }

    // --- totals ---
    if (y > doc.page.height - MARGIN - 130) {
      doc.addPage();
      y = MARGIN;
    }
    y += 12;

    const totalsRow = (label: string, value: string, strong = false) => {
      doc.font(strong ? BOLD : BODY).fontSize(strong ? 12 : 10);
      doc.fillColor(strong ? TEXT : MUTED);
      doc.text(label, 300, y, { width: 130, align: 'right', lineBreak: false });
      doc.fillColor(TEXT);
      doc.text(value, COL.amount.x, y, {
        width: COL.amount.w,
        align: 'right',
        lineBreak: false,
      });
      y += strong ? 20 : 16;
    };

    totalsRow('Subtotal', money(inv.subtotal ?? inv.totalAmount, currency));
    if (inv.discountTotal)
      totalsRow('Discount', `- ${money(inv.discountTotal, currency)}`);
    totalsRow('Total', money(inv.totalAmount, currency));
    if (inv.amountPaid)
      totalsRow('Paid', `- ${money(inv.amountPaid, currency)}`);

    doc
      .moveTo(300, y)
      .lineTo(RIGHT, y)
      .lineWidth(1)
      .strokeColor(BORDER)
      .stroke();
    y += 8;
    totalsRow(
      'Balance due',
      money(inv.balanceDue ?? inv.totalAmount, currency),
      true,
    );

    // --- notes / additional information ---
    y += 6;
    for (const [title, body] of [
      ['NOTES', inv.notes],
      ['ADDITIONAL INFORMATION', inv.additionalInfo],
    ] as const) {
      const text = safeBlock(body);
      if (!text) continue;
      doc.font(BODY).fontSize(9.5);
      const blockH = 13 + doc.heightOfString(text, { width: CONTENT_W });
      // Start the block on a fresh page rather than splitting its heading off;
      // a block taller than a page still flows on (PDFKit paginates text).
      if (y + blockH > doc.page.height - MARGIN) {
        doc.addPage();
        y = MARGIN;
      }
      this.label(doc, title, LEFT, y);
      y += 13;
      doc.font(BODY).fontSize(9.5).fillColor(TEXT);
      doc.text(text, LEFT, y, { width: CONTENT_W });
      y = doc.y + 14;
    }

    // --- footer ---
    y += 8;
    doc
      .moveTo(LEFT, y)
      .lineTo(RIGHT, y)
      .lineWidth(1)
      .strokeColor(BORDER)
      .stroke();
    y += 10;
    const terms = inv.dueDate
      ? `Payment is due by ${formatDate(inv.dueDate)}. `
      : inv.business?.paymentTermsDays
        ? `Payment is due within ${inv.business.paymentTermsDays} days of the issue date. `
        : '';
    doc.font(BODY).fontSize(9).fillColor(MUTED);
    doc.text(`${terms}Thank you for your business.`, LEFT, y, {
      width: CONTENT_W,
    });
  }

  private drawItemsHeader(doc: Doc, y: number): number {
    doc.rect(LEFT, y, CONTENT_W, 22).fill(HEAD_BG);
    doc.font(BOLD).fontSize(8).fillColor('#374151');
    const top = y + 7;
    doc.text('DESCRIPTION', COL.desc.x + 6, top, {
      width: COL.desc.w,
      lineBreak: false,
    });
    doc.text('QTY', COL.qty.x, top, {
      width: COL.qty.w,
      align: 'center',
      lineBreak: false,
    });
    doc.text('UNIT PRICE', COL.price.x, top, {
      width: COL.price.w,
      align: 'right',
      lineBreak: false,
    });
    doc.text('DISC', COL.disc.x, top, {
      width: COL.disc.w,
      align: 'center',
      lineBreak: false,
    });
    doc.text('AMOUNT', COL.amount.x - 6, top, {
      width: COL.amount.w,
      align: 'right',
      lineBreak: false,
    });
    return y + 22;
  }

  private drawItemRow(
    doc: Doc,
    item: InvoicePdfItem,
    rowIndex: number,
    y: number,
    currency: string,
  ): number {
    const name = safe(item.product?.name) || 'Item';
    doc.font(BODY).fontSize(9.5);
    // Measure first so a wrapped description gets a correctly sized row.
    const nameHeight = doc.heightOfString(name, { width: COL.desc.w });
    const rowH = Math.max(nameHeight + 12, 24);

    if (rowIndex % 2 === 1) doc.rect(LEFT, y, CONTENT_W, rowH).fill(ZEBRA);

    const top = y + 6;
    doc.fillColor(TEXT).font(BODY).fontSize(9.5);
    doc.text(name, COL.desc.x + 6, top, { width: COL.desc.w });
    doc.text(String(item.quantity ?? 0), COL.qty.x, top, {
      width: COL.qty.w,
      align: 'center',
      lineBreak: false,
    });
    doc.text(money(item.product?.unitPrice, currency), COL.price.x, top, {
      width: COL.price.w,
      align: 'right',
      lineBreak: false,
    });
    doc.text(item.discount ? `${item.discount}%` : '-', COL.disc.x, top, {
      width: COL.disc.w,
      align: 'center',
      lineBreak: false,
    });
    doc.text(money(item.amount, currency), COL.amount.x - 6, top, {
      width: COL.amount.w,
      align: 'right',
      lineBreak: false,
    });

    const bottom = y + rowH;
    doc
      .moveTo(LEFT, bottom)
      .lineTo(RIGHT, bottom)
      .lineWidth(0.5)
      .strokeColor(BORDER)
      .stroke();
    return bottom;
  }

  private drawBadge(doc: Doc, text: string, y: number, paid: boolean): void {
    doc.font(BOLD).fontSize(8);
    const w = doc.widthOfString(text) + 24;
    const x = RIGHT - w;
    doc.roundedRect(x, y, w, 16, 8).fill(paid ? '#e6f7ee' : '#fff1e2');
    doc.fillColor(paid ? '#12965a' : '#c9720b');
    doc.text(text, x, y + 4.5, { width: w, align: 'center', lineBreak: false });
  }

  private label(doc: Doc, text: string, x: number, y: number): void {
    doc.font(BOLD).fontSize(7.5).fillColor(MUTED);
    doc.text(text, x, y, {
      width: 150,
      lineBreak: false,
      characterSpacing: 0.6,
    });
  }

  // ---- plumbing ------------------------------------------------------------

  /** Run a draw routine and collect the document into a Buffer. */
  private render(build: (doc: Doc) => void): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        build(doc);
        doc.end();
      } catch (err) {
        this.logger.error(`PDF render failed: ${(err as Error).message}`);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
