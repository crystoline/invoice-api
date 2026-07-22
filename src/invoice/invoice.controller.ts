import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { InvoiceService } from './invoice.service';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { InvoiceRequestDto, InvoiceApprovalDto } from './dto/invoice.dto';

/**
 * InvoiceController — `/api/invoices`. Static routes are declared before the
 * catch-all `:invoiceId`. PDFs are streamed as real binary attachments (the
 * legacy base64-in-JSON wrapper is intentionally not reproduced).
 */
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Post('invoice')
  create(@Body() dto: InvoiceRequestDto, @CurrentUser() user: AuthUser) {
    return this.invoices.createInvoice(dto, user);
  }

  @Get('currency-codes')
  currencyCodes() {
    return this.invoices.getCurrencyCodes();
  }

  @Get('paginated-invoices')
  paginated(@Query('page') page = '0', @Query('size') size = '10', @CurrentUser() user: AuthUser) {
    return this.invoices.getAllInvoicesInPagination(Number(page) || 0, Number(size) || 10, user);
  }

  @Get('business/:businessId')
  byBusiness(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser) {
    return this.invoices.getBusinessInvoices(BigInt(businessId), user);
  }

  @Put('invoice/update/:invoiceId')
  update(@Param('invoiceId') invoiceId: string, @Body() dto: InvoiceRequestDto, @CurrentUser() user: AuthUser) {
    return this.invoices.updateInvoice(BigInt(invoiceId), dto, user);
  }

  @Delete('invoice/delete/:invoiceId')
  remove(@Param('invoiceId') invoiceId: string, @CurrentUser() user: AuthUser) {
    return this.invoices.deleteInvoice(BigInt(invoiceId), user);
  }

  @Post('invoice/duplicate/:invoiceId')
  duplicate(@Param('invoiceId') invoiceId: string, @CurrentUser() user: AuthUser) {
    return this.invoices.duplicateInvoice(BigInt(invoiceId), user);
  }

  @Post('invoice/approve')
  approve(@Body() dto: InvoiceApprovalDto, @CurrentUser() user: AuthUser) {
    return this.invoices.approveInvoice(dto, user);
  }

  @Post('send-invoice/:invoiceId')
  send(@Param('invoiceId') invoiceId: string, @CurrentUser() user: AuthUser) {
    return this.invoices.sendInvoice(BigInt(invoiceId), user);
  }

  @Get(':id/raw-download')
  async raw(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const buffer = await this.invoices.downloadRaw(BigInt(id), user);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="invoice_raw${id}.pdf"` });
    res.send(buffer);
  }

  @Get(':id/default-template-download')
  async defaultTemplate(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const buffer = await this.invoices.downloadDefaultTemplate(BigInt(id), user);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice_default_template${id}.pdf"`,
    });
    res.send(buffer);
  }

  // Alias for the existing frontend (invoice.service.js calls /invoices/invoice/download/:id as a blob).
  @Get('invoice/download/:id')
  async download(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const buffer = await this.invoices.downloadDefaultTemplate(BigInt(id), user);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="invoice_${id}.pdf"` });
    res.send(buffer);
  }

  @Get(':invoiceId')
  getOne(@Param('invoiceId') invoiceId: string, @CurrentUser() user: AuthUser) {
    return this.invoices.getInvoice(BigInt(invoiceId), user);
  }
}
