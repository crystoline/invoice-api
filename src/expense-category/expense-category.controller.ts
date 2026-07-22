import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ExpenseCategoryService } from './expense-category.service';
import { ExpenseCategoryRequestDto } from './dto/expense-category.dto';

/** ExpenseCategoryController — `/api/expense-categories`. */
@Controller('expense-categories')
export class ExpenseCategoryController {
  constructor(private readonly service: ExpenseCategoryService) {}

  @Post()
  create(@Body() dto: ExpenseCategoryRequestDto) {
    return this.service.create(dto);
  }

  @Get('business/:businessId')
  byBusiness(@Param('businessId') businessId: string) {
    return this.service.getByBusiness(BigInt(businessId));
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: ExpenseCategoryRequestDto) {
    return this.service.update(BigInt(id), dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(BigInt(id));
  }
}
