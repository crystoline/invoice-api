import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { VendorService } from './vendor.service';
import { VendorRequestDto, VendorProductRequestDto } from './dto/vendor.dto';
import { BusinessPermission } from '../common/authz/authz.decorators';
import { Permission } from '../common/authz/permissions';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

/**
 * VendorController — `/api/vendors`. Vendors belong to a business; every route
 * is scoped to it. Literal routes are declared before `:id`.
 */
@Controller('vendors')
export class VendorController {
  constructor(private readonly vendors: VendorService) {}

  @Post('vendor')
  @BusinessPermission(Permission.WRITE, { body: 'businessId' })
  create(@Body() dto: VendorRequestDto) {
    return this.vendors.createVendor(dto);
  }

  /** Every vendor on the platform, including legacy unassigned ones. */
  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  getAll() {
    return this.vendors.getAllVendors();
  }

  @Get('business/:businessId')
  @BusinessPermission(Permission.VIEW, { param: 'businessId' })
  byBusiness(@Param('businessId') businessId: string) {
    return this.vendors.getVendorsForBusiness(BigInt(businessId));
  }

  @Get('vendor-products/:vendorId')
  @BusinessPermission(Permission.VIEW, {
    resource: 'vendor',
    idParam: 'vendorId',
  })
  vendorProducts(@Param('vendorId') vendorId: string) {
    return this.vendors.getVendorProductsByVendorId(BigInt(vendorId));
  }

  @Post('toggle/:vendorId')
  @BusinessPermission(Permission.WRITE, {
    resource: 'vendor',
    idParam: 'vendorId',
  })
  toggle(@Param('vendorId') vendorId: string) {
    return this.vendors.toggleVendor(BigInt(vendorId));
  }

  @Post(':vendorId/vendor-product')
  @BusinessPermission(Permission.WRITE, {
    resource: 'vendor',
    idParam: 'vendorId',
  })
  addProduct(
    @Param('vendorId') vendorId: string,
    @Body() dto: VendorProductRequestDto,
  ) {
    return this.vendors.addVendorProduct(BigInt(vendorId), dto);
  }

  // The path variable is the vendor-PRODUCT id (legacy naming).
  @Put('vendor-product/:vendorId')
  @BusinessPermission(Permission.WRITE, {
    resource: 'vendorProduct',
    idParam: 'vendorId',
  })
  updateProduct(
    @Param('vendorId') vendorProductId: string,
    @Body() dto: VendorProductRequestDto,
  ) {
    return this.vendors.updateVendorProduct(BigInt(vendorProductId), dto);
  }

  @Get(':id')
  @BusinessPermission(Permission.VIEW, { resource: 'vendor', idParam: 'id' })
  getOne(@Param('id') id: string) {
    return this.vendors.getVendorById(BigInt(id));
  }

  @Put(':id')
  @BusinessPermission(Permission.WRITE, { resource: 'vendor', idParam: 'id' })
  update(@Param('id') id: string, @Body() dto: VendorRequestDto) {
    return this.vendors.updateVendor(BigInt(id), dto);
  }

  @Delete(':id')
  @BusinessPermission(Permission.DELETE, { resource: 'vendor', idParam: 'id' })
  remove(@Param('id') id: string) {
    return this.vendors.deleteVendor(BigInt(id));
  }
}
