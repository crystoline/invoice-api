import type { ServerResponse } from 'http';
import { resolve } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { EmailModule } from './email/email.module';
import { PdfModule } from './pdf/pdf.module';
import { StorageModule } from './storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { BusinessModule } from './business/business.module';
import { CustomerModule } from './customer/customer.module';
import { ProductModule } from './product/product.module';
import { InvoiceModule } from './invoice/invoice.module';
import { VendorModule } from './vendor/vendor.module';
import { IncomeModule } from './income/income.module';
import { BillsModule } from './bills/bills.module';
import { ExpenseCategoryModule } from './expense-category/expense-category.module';
import { PlanModule } from './plan/plan.module';
import { CustomFieldModule } from './custom-field/custom-field.module';
import { RecurringInvoiceModule } from './recurring-invoice/recurring-invoice.module';
import { PaymentModule } from './payment/payment.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportModule } from './report/report.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { NotificationModule } from './notification/notification.module';
import { TaxModule } from './tax/tax.module';
import { CustomerPortalModule } from './customer-portal/customer-portal.module';
import { AdminModule } from './admin/admin.module';
import { WebhookModule } from './webhook/webhook.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuthzModule } from './common/authz/authz.module';
import { AuthorizationGuard } from './common/authz/authorization.guard';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(), // enables @Cron (recurring-invoice generation)
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]), // basic rate limiting: 300 req/min/IP
    // Only business logos are public (they appear on customer-facing
    // invoices). Receipts are served by GET /api/bills/bill/:id/receipt,
    // which checks the caller's access to the bill's business.
    ServeStaticModule.forRoot({
      // resolve(), not join(): UPLOAD_DIR may be absolute (must match StorageService).
      rootPath: resolve(
        process.cwd(),
        process.env.UPLOAD_DIR ?? 'uploads',
        'logos',
      ),
      serveRoot: '/uploads/logos',
      serveStaticOptions: {
        setHeaders: (res: ServerResponse) => {
          res.setHeader('X-Content-Type-Options', 'nosniff');
        },
      },
    }),
    PrismaModule,
    AuthzModule,
    EmailModule,
    PdfModule,
    StorageModule,
    AuthModule,
    BusinessModule,
    CustomerModule,
    ProductModule,
    InvoiceModule,
    VendorModule,
    IncomeModule,
    BillsModule,
    ExpenseCategoryModule,
    PlanModule,
    CustomFieldModule,
    RecurringInvoiceModule,
    PaymentModule,
    DashboardModule,
    ReportModule,
    SubscriptionModule,
    NotificationModule,
    TaxModule,
    CustomerPortalModule,
    AdminModule,
    WebhookModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Rate limiting, then JWT on every route except @Public(), then platform
    // @Roles(), then business membership/permission (fails closed — see AuthorizationGuard).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
  ],
})
export class AppModule {}
