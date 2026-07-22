import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { RecurringInvoiceService } from './recurring-invoice.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { CreateRecurringInvoiceDto, UpdateRecurringInvoiceDto } from './dto/recurring-invoice.dto';

/** RecurringInvoiceController — `/api/recurring-invoices`. */
@Controller('recurring-invoices')
export class RecurringInvoiceController {
  constructor(private readonly service: RecurringInvoiceService) {}

  @Post()
  create(@Body() dto: CreateRecurringInvoiceDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get('business/:businessId')
  byBusiness(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser) {
    return this.service.getByBusiness(BigInt(businessId), user);
  }

  // Manual trigger of the daily generation (for testing / ops). Admin-only.
  @Post('run-due')
  @Roles(Role.SUPER_ADMIN)
  runDue() {
    return this.service.generateDue();
  }

  @Post(':id/pause')
  pause(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setActive(BigInt(id), false, user);
  }

  @Post(':id/resume')
  resume(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setActive(BigInt(id), true, user);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getById(BigInt(id), user);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRecurringInvoiceDto, @CurrentUser() user: AuthUser) {
    return this.service.update(BigInt(id), dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(BigInt(id), user);
  }
}
