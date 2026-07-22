import { Body, Controller, Delete, Get, Param, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BillsService } from './bills.service';
import { BillRequestDto } from './dto/bills.dto';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';

/** BillsController — `/api/bills`. Literal routes before `bill/:billId`. */
@Controller('bills')
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  @Post('bill')
  create(@Body() dto: BillRequestDto, @CurrentUser() user: AuthUser) {
    return this.bills.createBill(dto, user);
  }

  @Post('bill/mark-as-paid/:billId')
  markPaid(@Param('billId') billId: string) {
    return this.bills.markAsPaid(BigInt(billId));
  }

  @Post('bill/:billId/receipt')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadReceipt(@Param('billId') billId: string, @UploadedFile() file: Express.Multer.File) {
    return this.bills.uploadReceipt(BigInt(billId), file);
  }

  @Get()
  getAll() {
    return this.bills.getAllBills();
  }

  @Get('business/:businessId')
  byBusiness(@Param('businessId') businessId: string) {
    return this.bills.getByBusiness(BigInt(businessId));
  }

  @Get('bill/:billId')
  getOne(@Param('billId') billId: string) {
    return this.bills.getById(BigInt(billId));
  }

  @Put('bill/:billId')
  update(@Param('billId') billId: string, @Body() dto: BillRequestDto) {
    return this.bills.update(BigInt(billId), dto);
  }

  @Delete('bill/:billId')
  remove(@Param('billId') billId: string) {
    return this.bills.remove(BigInt(billId));
  }
}
