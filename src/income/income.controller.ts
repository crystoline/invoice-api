import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { IncomeService } from './income.service';
import { IncomeRequestDto } from './dto/income.dto';

/** IncomeController — `/api/income`. Authenticated; no additional role checks. */
@Controller('income')
export class IncomeController {
  constructor(private readonly income: IncomeService) {}

  @Post()
  create(@Body() dto: IncomeRequestDto) {
    return this.income.create(dto);
  }

  @Get('business/:businessId')
  byBusiness(@Param('businessId') businessId: string) {
    return this.income.getByBusiness(BigInt(businessId));
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: IncomeRequestDto) {
    return this.income.update(BigInt(id), dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.income.remove(BigInt(id));
  }
}
