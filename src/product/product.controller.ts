import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ProductService } from './product.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { ProductRequestDto } from './dto/product.dto';

/**
 * ProductController — `/api/products`. Literal routes declared before `:productId`.
 * The legacy literal-space delete-all route (`/products/%20`) is replaced by a
 * clean `DELETE /products` gated to SUPER_ADMIN.
 */
@Controller('products')
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Post(':businessId/product')
  create(@Param('businessId') businessId: string, @Body() dto: ProductRequestDto, @CurrentUser() user: AuthUser) {
    return this.products.createProduct(BigInt(businessId), dto, user);
  }

  @Get()
  getAll(@CurrentUser() user: AuthUser) {
    return this.products.getAllProducts(user);
  }

  @Get('paginated-products')
  paginated(@Query('page') page = '0', @Query('size') size = '10', @CurrentUser() user: AuthUser) {
    return this.products.getAllProductsPaginated(Number(page) || 0, Number(size) || 10, user);
  }

  @Get(':businessId/business-products')
  forBusiness(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser) {
    return this.products.getProductsForBusiness(BigInt(businessId), user);
  }

  @Get(':productId')
  getOne(@Param('productId') productId: string) {
    return this.products.getProduct(BigInt(productId));
  }

  @Put(':businessId/:productId')
  update(@Param('businessId') businessId: string, @Param('productId') productId: string, @Body() dto: ProductRequestDto) {
    return this.products.updateProduct(BigInt(businessId), BigInt(productId), dto);
  }

  @Post('toggle-product/:businessId/:productId')
  toggle(@Param('businessId') businessId: string, @Param('productId') productId: string, @CurrentUser() user: AuthUser) {
    return this.products.toggleProductStatus(BigInt(businessId), BigInt(productId), user);
  }

  @Delete()
  @Roles(Role.SUPER_ADMIN)
  deleteAll() {
    return this.products.deleteAllProducts();
  }

  @Delete(':productId')
  @Roles(Role.ADMIN)
  remove(@Param('productId') productId: string) {
    return this.products.deleteProduct(BigInt(productId));
  }
}
