import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { RecurringInvoiceService } from './recurring-invoice.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  CreateRecurringInvoiceDto,
  UpdateRecurringInvoiceDto,
} from './dto/recurring-invoice.dto';
import { BusinessPermission } from '../common/authz/authz.decorators';
import { Permission } from '../common/authz/permissions';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';

/** RecurringInvoiceController — `/api/recurring-invoices`. */
@Controller('recurring-invoices')
export class RecurringInvoiceController {
  constructor(private readonly service: RecurringInvoiceService) {}

  @BusinessPermission(Permission.WRITE, {
    resource: 'invoice',
    idBody: 'templateInvoiceId',
  })
  @Post()
  create(
    @Body() dto: CreateRecurringInvoiceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(dto, user);
  }

  @BusinessPermission(Permission.VIEW, { param: 'businessId' })
  @Get('business/:businessId')
  byBusiness(@Param('businessId') businessId: string) {
    return this.service.getByBusiness(BigInt(businessId));
  }

  // Manual trigger of the daily generation (for testing / ops). Admin-only.
  @Post('run-due')
  @Roles(Role.SUPER_ADMIN)
  runDue() {
    return this.service.generateDue();
  }

  @BusinessPermission(Permission.WRITE, {
    resource: 'recurringInvoice',
    idParam: 'id',
  })
  @Post(':id/pause')
  pause(@Param('id') id: string) {
    return this.service.setActive(BigInt(id), false);
  }

  @BusinessPermission(Permission.WRITE, {
    resource: 'recurringInvoice',
    idParam: 'id',
  })
  @Post(':id/resume')
  resume(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setActive(BigInt(id), true, user);
  }

  @BusinessPermission(Permission.VIEW, {
    resource: 'recurringInvoice',
    idParam: 'id',
  })
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.service.getById(BigInt(id));
  }

  @BusinessPermission(Permission.WRITE, {
    resource: 'recurringInvoice',
    idParam: 'id',
  })
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRecurringInvoiceDto) {
    return this.service.update(BigInt(id), dto);
  }

  @BusinessPermission(Permission.DELETE, {
    resource: 'recurringInvoice',
    idParam: 'id',
  })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(BigInt(id));
  }
}
