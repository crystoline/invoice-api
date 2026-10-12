import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ExpenseCategoryService } from './expense-category.service';
import { ExpenseCategoryRequestDto } from './dto/expense-category.dto';
import { BusinessPermission } from '../common/authz/authz.decorators';
import { Permission } from '../common/authz/permissions';

/** ExpenseCategoryController — `/api/expense-categories`. */
@Controller('expense-categories')
export class ExpenseCategoryController {
  constructor(private readonly service: ExpenseCategoryService) {}

  @BusinessPermission(Permission.WRITE, { body: 'businessId' })
  @Post()
  create(@Body() dto: ExpenseCategoryRequestDto) {
    return this.service.create(dto);
  }

  @BusinessPermission(Permission.VIEW, { param: 'businessId' })
  @Get('business/:businessId')
  byBusiness(@Param('businessId') businessId: string) {
    return this.service.getByBusiness(BigInt(businessId));
  }

  @BusinessPermission(Permission.WRITE, {
    resource: 'expenseCategory',
    idParam: 'id',
  })
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: ExpenseCategoryRequestDto) {
    return this.service.update(BigInt(id), dto);
  }

  @BusinessPermission(Permission.DELETE, {
    resource: 'expenseCategory',
    idParam: 'id',
  })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(BigInt(id));
  }
}
