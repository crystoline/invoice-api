import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { InvoiceService } from './invoice.service';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { InvoiceRequestDto, InvoiceApprovalDto } from './dto/invoice.dto';
import {
  Authenticated,
  BusinessPermission,
} from '../common/authz/authz.decorators';
import { Permission } from '../common/authz/permissions';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

/**
 * InvoiceController — `/api/invoices`. Static routes are declared before the
 * catch-all `:invoiceId`. PDFs are streamed as real binary attachments (the
 * legacy base64-in-JSON wrapper is intentionally not reproduced).
 */
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @BusinessPermission(Permission.WRITE, { body: 'businessId' })
  @Post('invoice')
  create(@Body() dto: InvoiceRequestDto, @CurrentUser() user: AuthUser) {
    return this.invoices.createInvoice(dto, user);
  }

  @Authenticated()
  @Get('currency-codes')
  currencyCodes() {
    return this.invoices.getCurrencyCodes();
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN) // every business's invoices
  @Get('paginated-invoices')
  paginated(
    @Query('page') page = '0',
    @Query('size') size = '10',
    @CurrentUser() user: AuthUser,
  ) {
    return this.invoices.getAllInvoicesInPagination(
      Number(page) || 0,
      Number(size) || 10,
      user,
    );
  }

  @BusinessPermission(Permission.VIEW, { param: 'businessId' })
  @Get('business/:businessId')
  byBusiness(@Param('businessId') businessId: string) {
    return this.invoices.getBusinessInvoices(BigInt(businessId));
  }

  @BusinessPermission(Permission.WRITE, {
    resource: 'invoice',
    idParam: 'invoiceId',
  })
  @Put('invoice/update/:invoiceId')
  update(
    @Param('invoiceId') invoiceId: string,
    @Body() dto: InvoiceRequestDto,
  ) {
    return this.invoices.updateInvoice(BigInt(invoiceId), dto);
  }

  @BusinessPermission(Permission.DELETE, {
    resource: 'invoice',
    idParam: 'invoiceId',
  })
  @Delete('invoice/delete/:invoiceId')
  remove(@Param('invoiceId') invoiceId: string) {
    return this.invoices.deleteInvoice(BigInt(invoiceId));
  }

  @BusinessPermission(Permission.WRITE, {
    resource: 'invoice',
    idParam: 'invoiceId',
  })
  @Post('invoice/duplicate/:invoiceId')
  duplicate(@Param('invoiceId') invoiceId: string) {
    return this.invoices.duplicateInvoice(BigInt(invoiceId));
  }

  @BusinessPermission(Permission.APPROVE, {
    resource: 'invoice',
    idBody: 'invoiceId',
  })
  @Post('invoice/approve')
  approve(@Body() dto: InvoiceApprovalDto) {
    return this.invoices.approveInvoice(dto);
  }

  @BusinessPermission(Permission.WRITE, {
    resource: 'invoice',
    idParam: 'invoiceId',
  })
  @Post('send-invoice/:invoiceId')
  send(@Param('invoiceId') invoiceId: string) {
    return this.invoices.sendInvoice(BigInt(invoiceId));
  }

  @BusinessPermission(Permission.VIEW, { resource: 'invoice', idParam: 'id' })
  @Get(':id/raw-download')
  async raw(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.invoices.downloadRaw(BigInt(id));
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice_raw${id}.pdf"`,
    });
    res.send(buffer);
  }

  @BusinessPermission(Permission.VIEW, { resource: 'invoice', idParam: 'id' })
  @Get(':id/default-template-download')
  async defaultTemplate(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.invoices.downloadDefaultTemplate(BigInt(id));
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice_default_template${id}.pdf"`,
    });
    res.send(buffer);
  }

  // Alias for the existing frontend (invoice.service.js calls /invoices/invoice/download/:id as a blob).
  @BusinessPermission(Permission.VIEW, { resource: 'invoice', idParam: 'id' })
  @Get('invoice/download/:id')
  async download(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.invoices.downloadDefaultTemplate(BigInt(id));
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice_${id}.pdf"`,
    });
    res.send(buffer);
  }

  @BusinessPermission(Permission.VIEW, {
    resource: 'invoice',
    idParam: 'invoiceId',
  })
  @Get(':invoiceId')
  getOne(@Param('invoiceId') invoiceId: string) {
    return this.invoices.getInvoice(BigInt(invoiceId));
  }
}
