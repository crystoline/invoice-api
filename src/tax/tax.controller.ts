import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { TaxService } from './tax.service';
import { CreateTaxRateDto, UpdateTaxRateDto } from './dto/tax-rate.dto';

/** TaxRateController — `/api/tax-rates`. */
@Controller('tax-rates')
export class TaxController {
  constructor(private readonly service: TaxService) {}

  @Post()
  create(@Body() dto: CreateTaxRateDto) {
    return this.service.create(dto);
  }

  @Get('business/:businessId')
  byBusiness(@Param('businessId') businessId: string) {
    return this.service.getByBusiness(BigInt(businessId));
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaxRateDto) {
    return this.service.update(BigInt(id), dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(BigInt(id));
  }
}
