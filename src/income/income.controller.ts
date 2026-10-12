import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { IncomeService } from './income.service';
import { IncomeRequestDto } from './dto/income.dto';
import { BusinessPermission } from '../common/authz/authz.decorators';
import { Permission } from '../common/authz/permissions';

/** IncomeController — `/api/income`. Authenticated; no additional role checks. */
@Controller('income')
export class IncomeController {
  constructor(private readonly income: IncomeService) {}

  @BusinessPermission(Permission.WRITE, { body: 'businessId' })
  @Post()
  create(@Body() dto: IncomeRequestDto) {
    return this.income.create(dto);
  }

  @BusinessPermission(Permission.VIEW, { param: 'businessId' })
  @Get('business/:businessId')
  byBusiness(@Param('businessId') businessId: string) {
    return this.income.getByBusiness(BigInt(businessId));
  }

  @BusinessPermission(Permission.WRITE, { resource: 'income', idParam: 'id' })
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: IncomeRequestDto) {
    return this.income.update(BigInt(id), dto);
  }

  @BusinessPermission(Permission.DELETE, { resource: 'income', idParam: 'id' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.income.remove(BigInt(id));
  }
}
