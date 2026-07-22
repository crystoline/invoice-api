import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Email sender. In the legacy app all live email goes through ZeptoMail SMTP
 * (the SendChamp REST path is dead code). We reproduce that via Nodemailer SMTP,
 * configured entirely from env (ZEPTO_* — never hardcoded). If SMTP is not
 * configured, sends are logged and skipped so the app still runs in dev.
 *
 * Templates mirror the legacy ZeptoEmailService subjects/wording for parity.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('ZEPTO_HOST');
    const user = this.config.get<string>('ZEPTO_USER');
    const pass = this.config.get<string>('ZEPTO_PASS');
    this.from = this.config.get<string>('ZEPTO_FROM') ?? 'noreply@go54.com';
    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(this.config.get<string>('ZEPTO_PORT') ?? 465),
        secure: true, // implicit SSL on 465 (mail.smtps.ssl.enable=true)
        auth: { user, pass },
      });
    } else {
      this.logger.warn('ZeptoMail SMTP not configured (ZEPTO_*): emails will be logged, not sent.');
    }
  }

  async sendMail(to: string, subject: string, html: string, from?: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[email skipped] to=${to} subject="${subject}"`);
      return;
    }
    try {
      await this.transporter.sendMail({ from: from ?? this.from, to, subject, html });
    } catch (err) {
      // Legacy swallows MailSendException; we log and continue.
      this.logger.error(`Failed to send email to ${to}: ${(err as Error).message}`);
    }
  }

  async sendVerificationEmail(to: string, firstName: string, link: string): Promise<void> {
    await this.sendMail(to, 'Account Verification', this.card('Verify Your Account', firstName, 'Verify Account', link));
  }

  async sendPasswordEmailConfirmation(to: string, firstName: string, link: string): Promise<void> {
    // Legacy subject has literal double spaces.
    await this.sendMail(
      to,
      'Confirm Email to  Reset  your password',
      this.card('Welcome to Our Platform!', firstName, 'Verify Email Address', link),
    );
  }

  private card(header: string, firstName: string, cta: string, link: string): string {
    return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f4f6f8;padding:24px">
      <div style="max-width:520px;margin:auto;background:#fff;border-radius:12px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#2563eb,#1e40af);color:#fff;padding:24px">
          <h1 style="margin:0;font-size:20px">${header}</h1>
        </div>
        <div style="padding:24px;color:#111">
          <p>Hello ${firstName ?? ''},</p>
          <p style="text-align:center;margin:28px 0">
            <a href="${link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block">${cta}</a>
          </p>
          <p style="color:#6b7280;font-size:12px">If the button doesn't work, paste this link into your browser:<br>${link}</p>
        </div>
        <div style="padding:16px;text-align:center;color:#9ca3af;font-size:12px">© 2025 Netron Technologies Inc.</div>
      </div></body></html>`;
  }
}
