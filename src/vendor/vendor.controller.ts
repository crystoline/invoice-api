import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { VendorService } from './vendor.service';
import { VendorRequestDto, VendorProductRequestDto } from './dto/vendor.dto';

/**
 * VendorController — `/api/vendors`. The legacy literal-space list route
 * (`/vendors/%20`) is replaced by a clean `GET /vendors`. All routes are
 * authenticated with no additional role checks (as in the legacy app).
 */
@Controller('vendors')
export class VendorController {
  constructor(private readonly vendors: VendorService) {}

  @Post('vendor')
  create(@Body() dto: VendorRequestDto) {
    return this.vendors.createVendor(dto);
  }

  @Get()
  getAll() {
    return this.vendors.getAllVendors();
  }

  @Get('vendor-products/:vendorId')
  vendorProducts(@Param('vendorId') vendorId: string) {
    return this.vendors.getVendorProductsByVendorId(BigInt(vendorId));
  }

  @Post('toggle/:vendorId')
  toggle(@Param('vendorId') vendorId: string) {
    return this.vendors.toggleVendor(BigInt(vendorId));
  }

  @Post(':vendorId/vendor-product')
  addProduct(@Param('vendorId') vendorId: string, @Body() dto: VendorProductRequestDto) {
    return this.vendors.addVendorProduct(BigInt(vendorId), dto);
  }

  @Put('vendor-product/:vendorId')
  updateProduct(@Param('vendorId') vendorProductId: string, @Body() dto: VendorProductRequestDto) {
    return this.vendors.updateVendorProduct(BigInt(vendorProductId), dto);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.vendors.getVendorById(BigInt(id));
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: VendorRequestDto) {
    return this.vendors.updateVendor(BigInt(id), dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.vendors.deleteVendor(BigInt(id));
  }
}
