import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/** One line item as it appears on an invoice email. */
export interface InvoiceEmailItem {
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

/** Everything the invoice email template needs. */
export interface InvoiceEmailModel {
  to: string;
  customerName: string;
  businessName: string;
  businessEmail?: string | null;
  invoiceNumber: string;
  invoiceDate: Date | null;
  dueDate: Date | null;
  currencyCode: string;
  totalAmount: number;
  amountPaid: number;
  items: InvoiceEmailItem[];
  /** Attached as Invoice-<number>.pdf when present. */
  pdf?: Buffer | null;
}

interface SendOptions {
  text?: string;
  from?: string;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

interface LayoutOptions {
  title: string;
  /** Inbox preview line — shown after the subject in most clients. */
  preheader: string;
  bodyHtml: string;
  cta?: { label: string; url: string };
  /** Small print under the CTA (e.g. link fallback, expiry note). */
  note?: string;
}

const BRAND = '#2563eb';
const TEXT = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Escape untrusted text before interpolating into HTML. */
const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatMoney = (amount: number, currency: string): string => {
  const value = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (currency || 'NGN').toUpperCase(),
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    // Unknown/invalid ISO code — fall back to a plain number with the code.
    return `${(currency || '').toUpperCase()} ${value.toFixed(2)}`.trim();
  }
};

const formatDate = (d: Date | null): string => {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * Email sender. All live email goes out over SMTP (env-driven, ZEPTO_*), via
 * Nodemailer. If SMTP is not configured, sends are logged and skipped so the
 * app still runs in dev.
 *
 * Every message is built from one shared table-based layout: inline styles,
 * 600px max width, a hidden preheader, and a plain-text alternative — which is
 * what keeps these out of spam folders and readable in Outlook.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly from: string;
  private readonly appName: string;
  private readonly frontendUrl: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('ZEPTO_HOST');
    const user = this.config.get<string>('ZEPTO_USER');
    const pass = this.config.get<string>('ZEPTO_PASS');
    this.from = this.config.get<string>('ZEPTO_FROM') ?? 'noreply@go54.com';
    this.appName = this.config.get<string>('APP_NAME') ?? 'Invoicing';
    this.frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    if (host && user && pass) {
      const port = Number(this.config.get<string>('ZEPTO_PORT') ?? 465);
      // Port 465 = implicit TLS (connect over SSL). 587/25 = STARTTLS (plain
      // connect, then upgrade). Nodemailer's `secure` must match: true only for
      // 465. ZEPTO_SECURE can override for non-standard setups.
      const secureOverride = this.config.get<string>('ZEPTO_SECURE');
      const secure = secureOverride != null ? secureOverride === 'true' : port === 465;
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });
      this.logger.log(`SMTP configured: ${host}:${port} (secure=${secure}), from=${this.from}`);
    } else {
      this.logger.warn('SMTP not configured (ZEPTO_*): emails will be logged, not sent.');
    }
  }

  /** Verify SMTP connectivity at boot so misconfig shows up immediately, not on first send. */
  async onModuleInit(): Promise<void> {
    if (!this.transporter) return;
    try {
      await this.transporter.verify();
      this.logger.log('SMTP connection verified — emails will be sent.');
    } catch (err) {
      this.logger.error(`SMTP verify failed — check ZEPTO_* settings: ${(err as Error).message}`);
    }
  }

  async sendMail(to: string, subject: string, html: string, opts: SendOptions = {}): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[email skipped] to=${to} subject="${subject}"`);
      return;
    }
    try {
      await this.transporter.sendMail({
        from: opts.from ?? `"${this.appName}" <${this.from}>`,
        to,
        subject,
        html,
        text: opts.text,
        replyTo: opts.replyTo,
        attachments: opts.attachments,
      });
    } catch (err) {
      // Never let a mail failure break the calling request — log and continue.
      this.logger.error(`Failed to send email to ${to}: ${(err as Error).message}`);
    }
  }

  // ---- public templates ----------------------------------------------------

  async sendVerificationEmail(to: string, firstName: string, link: string): Promise<void> {
    const html = this.layout({
      title: 'Confirm your email address',
      preheader: `Confirm your email to finish setting up your ${this.appName} account.`,
      bodyHtml: `
        <p style="margin:0 0 14px">Hi ${esc(firstName) || 'there'},</p>
        <p style="margin:0 0 14px">Welcome to ${esc(this.appName)}. Confirm your email address to activate your account and start sending invoices.</p>`,
      cta: { label: 'Confirm email address', url: link },
      note: 'This link expires in 1 hour. If you did not create an account, you can safely ignore this email.',
    });
    await this.sendMail(to, `Confirm your email address`, html, {
      text: `Hi ${firstName || 'there'},\n\nWelcome to ${this.appName}. Confirm your email address to activate your account:\n\n${link}\n\nThis link expires in 1 hour. If you did not create an account, ignore this email.`,
    });
  }

  async sendPasswordEmailConfirmation(to: string, firstName: string, link: string): Promise<void> {
    const html = this.layout({
      title: 'Reset your password',
      preheader: `Use the link inside to choose a new ${this.appName} password.`,
      bodyHtml: `
        <p style="margin:0 0 14px">Hi ${esc(firstName) || 'there'},</p>
        <p style="margin:0 0 14px">We received a request to reset your ${esc(this.appName)} password. Click the button below to choose a new one.</p>`,
      cta: { label: 'Reset password', url: link },
      note: 'This link expires in 1 hour. If you did not request a password reset, ignore this email — your password will not change.',
    });
    await this.sendMail(to, 'Reset your password', html, {
      text: `Hi ${firstName || 'there'},\n\nWe received a request to reset your ${this.appName} password. Use this link to choose a new one:\n\n${link}\n\nThis link expires in 1 hour. If you did not request this, ignore this email — your password will not change.`,
    });
  }

  /** Invitation to join a business workspace. `joinUrl` is supplied by the caller. */
  async sendBusinessInvitationEmail(
    to: string,
    businessName: string,
    code: string,
    joinUrl: string,
    inviterName?: string,
  ): Promise<void> {
    const by = inviterName ? ` by ${esc(inviterName)}` : '';
    const html = this.layout({
      title: `You have been invited to join ${esc(businessName)}`,
      preheader: `Join ${businessName} on ${this.appName}.`,
      bodyHtml: `
        <p style="margin:0 0 14px">Hi there,</p>
        <p style="margin:0 0 14px">You have been invited${by} to join <strong>${esc(businessName)}</strong> on ${esc(this.appName)}.</p>
        <p style="margin:0 0 6px;color:${MUTED};font-size:13px">Your invitation code</p>
        <p style="margin:0 0 4px;font-size:22px;font-weight:700;letter-spacing:3px;font-family:monospace;color:${TEXT}">${esc(code)}</p>`,
      cta: { label: 'Accept invitation', url: joinUrl },
      note: 'If you were not expecting this invitation, you can ignore this email.',
    });
    await this.sendMail(to, `You have been invited to join ${businessName}`, html, {
      text: `You have been invited${inviterName ? ` by ${inviterName}` : ''} to join ${businessName} on ${this.appName}.\n\nInvitation code: ${code}\n\nAccept here: ${joinUrl}`,
    });
  }

  /** The invoice a customer receives — itemised, with the PDF attached. */
  async sendInvoiceEmail(model: InvoiceEmailModel): Promise<void> {
    const {
      to,
      customerName,
      businessName,
      invoiceNumber,
      invoiceDate,
      dueDate,
      currencyCode,
      totalAmount,
      amountPaid,
      items,
      pdf,
      businessEmail,
    } = model;

    const balance = Math.max(totalAmount - (amountPaid || 0), 0);
    const money = (n: number) => formatMoney(n, currencyCode);

    const rows = items
      .map(
        (it, i) => `
        <tr style="background:${i % 2 ? '#fbfbfd' : '#ffffff'}">
          <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};font-size:14px;color:${TEXT}">${esc(it.name)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};font-size:14px;color:${TEXT};text-align:center">${esc(it.quantity)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};font-size:14px;color:${TEXT};text-align:right">${money(it.unitPrice)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};font-size:14px;color:${TEXT};text-align:right;white-space:nowrap">${money(it.amount)}</td>
        </tr>`,
      )
      .join('');

    const totalRow = (label: string, value: string, strong = false) => `
      <tr>
        <td style="padding:5px 12px;font-size:${strong ? '15px' : '14px'};color:${strong ? TEXT : MUTED};text-align:right">${esc(label)}</td>
        <td style="padding:5px 12px;font-size:${strong ? '16px' : '14px'};font-weight:${strong ? '700' : '500'};color:${strong ? TEXT : MUTED};text-align:right;white-space:nowrap;min-width:110px">${value}</td>
      </tr>`;

    const bodyHtml = `
      <p style="margin:0 0 14px">Hi ${esc(customerName) || 'there'},</p>
      <p style="margin:0 0 20px">Please find invoice <strong>${esc(invoiceNumber)}</strong> from ${esc(businessName)} below${pdf ? ', with a PDF copy attached' : ''}.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid ${BORDER};border-radius:8px">
        <tr>
          <td style="padding:14px 16px;font-size:13px;color:${MUTED}">Invoice number<br><span style="font-size:15px;color:${TEXT};font-weight:600">${esc(invoiceNumber)}</span></td>
          <td style="padding:14px 16px;font-size:13px;color:${MUTED}">Issued<br><span style="font-size:15px;color:${TEXT};font-weight:600">${formatDate(invoiceDate)}</span></td>
          <td style="padding:14px 16px;font-size:13px;color:${MUTED}">Due<br><span style="font-size:15px;color:${TEXT};font-weight:600">${formatDate(dueDate)}</span></td>
        </tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 8px">
        <thead>
          <tr>
            <th align="left" style="padding:8px 12px;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:${MUTED};border-bottom:2px solid ${BORDER}">Item</th>
            <th align="center" style="padding:8px 12px;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:${MUTED};border-bottom:2px solid ${BORDER}">Qty</th>
            <th align="right" style="padding:8px 12px;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:${MUTED};border-bottom:2px solid ${BORDER}">Price</th>
            <th align="right" style="padding:8px 12px;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:${MUTED};border-bottom:2px solid ${BORDER}">Amount</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="4" style="padding:14px 12px;color:${MUTED};font-size:14px">No line items.</td></tr>`}</tbody>
      </table>

      <table role="presentation" align="right" cellpadding="0" cellspacing="0" style="margin:0 0 8px">
        ${totalRow('Total', money(totalAmount))}
        ${amountPaid > 0 ? totalRow('Paid', `- ${money(amountPaid)}`) : ''}
        ${totalRow('Balance due', money(balance), true)}
      </table>
      <div style="clear:both"></div>`;

    const textLines = [
      `Hi ${customerName || 'there'},`,
      '',
      `Invoice ${invoiceNumber} from ${businessName}.`,
      `Issued: ${formatDate(invoiceDate)}   Due: ${formatDate(dueDate)}`,
      '',
      ...items.map((it) => `  ${it.name} x${it.quantity} @ ${money(it.unitPrice)} = ${money(it.amount)}`),
      '',
      `Total: ${money(totalAmount)}`,
      ...(amountPaid > 0 ? [`Paid: ${money(amountPaid)}`] : []),
      `Balance due: ${money(balance)}`,
      '',
      pdf ? 'A PDF copy of this invoice is attached.' : '',
    ];

    const html = this.layout({
      title: `Invoice ${esc(invoiceNumber)} from ${esc(businessName)}`,
      preheader: `${money(balance)} due by ${formatDate(dueDate)} — invoice ${invoiceNumber}.`,
      bodyHtml,
      note: 'Thank you for your business. Reply to this email if you have any questions about this invoice.',
    });

    await this.sendMail(to, `Invoice ${invoiceNumber} from ${businessName}`, html, {
      text: textLines.filter((l) => l !== undefined).join('\n'),
      replyTo: businessEmail || undefined,
      attachments: pdf
        ? [{ filename: `Invoice-${invoiceNumber}.pdf`, content: pdf, contentType: 'application/pdf' }]
        : undefined,
    });
  }

  // ---- layout --------------------------------------------------------------

  /**
   * Shared shell for every email. Table-based with inline styles because Gmail
   * and Outlook strip <style> blocks and ignore flex/grid.
   */
  private layout({ title, preheader, bodyHtml, cta, note }: LayoutOptions): string {
    const year = new Date().getFullYear();
    const button = cta
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0">
           <tr><td align="center" bgcolor="${BRAND}" style="border-radius:8px">
             <a href="${esc(cta.url)}" style="display:inline-block;padding:12px 26px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${esc(cta.label)}</a>
           </td></tr>
         </table>
         <p style="margin:0 0 6px;font-size:12px;color:${MUTED}">If the button does not work, paste this into your browser:</p>
         <p style="margin:0 0 4px;font-size:12px;color:${BRAND};word-break:break-all">${esc(cta.url)}</p>`
      : '';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:${FONT}">
      <tr>
        <td style="background:${BRAND};padding:18px 28px;color:#ffffff;font-size:17px;font-weight:700;letter-spacing:.2px">${esc(this.appName)}</td>
      </tr>
      <tr>
        <td style="padding:28px;color:${TEXT};font-size:15px;line-height:1.6">
          <h1 style="margin:0 0 18px;font-size:20px;line-height:1.3;color:${TEXT}">${title}</h1>
          ${bodyHtml}
          ${button}
          ${note ? `<p style="margin:22px 0 0;font-size:13px;color:${MUTED};line-height:1.5">${esc(note)}</p>` : ''}
        </td>
      </tr>
      <tr>
        <td style="padding:18px 28px;background:#f9fafb;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px;line-height:1.5">
          © ${year} ${esc(this.appName)}. This is an automated message — please do not share it.
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body></html>`;
  }
}
