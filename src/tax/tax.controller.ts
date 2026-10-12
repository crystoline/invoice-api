import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { TaxService } from './tax.service';
import { CreateTaxRateDto, UpdateTaxRateDto } from './dto/tax-rate.dto';
import { BusinessPermission } from '../common/authz/authz.decorators';
import { Permission } from '../common/authz/permissions';

/** TaxRateController — `/api/tax-rates`. */
@Controller('tax-rates')
export class TaxController {
  constructor(private readonly service: TaxService) {}

  @BusinessPermission(Permission.MANAGE_SETTINGS, { body: 'businessId' })
  @Post()
  create(@Body() dto: CreateTaxRateDto) {
    return this.service.create(dto);
  }

  @BusinessPermission(Permission.VIEW, { param: 'businessId' })
  @Get('business/:businessId')
  byBusiness(@Param('businessId') businessId: string) {
    return this.service.getByBusiness(BigInt(businessId));
  }

  @BusinessPermission(Permission.MANAGE_SETTINGS, {
    resource: 'taxRate',
    idParam: 'id',
  })
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaxRateDto) {
    return this.service.update(BigInt(id), dto);
  }

  @BusinessPermission(Permission.MANAGE_SETTINGS, {
    resource: 'taxRate',
    idParam: 'id',
  })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(BigInt(id));
  }
}
