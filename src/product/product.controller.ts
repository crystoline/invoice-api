import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ProductService } from './product.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { ProductRequestDto } from './dto/product.dto';
import { BusinessPermission } from '../common/authz/authz.decorators';
import { Permission } from '../common/authz/permissions';

/**
 * ProductController — `/api/products`. Literal routes declared before `:productId`.
 * The legacy literal-space delete-all route (`/products/%20`) is replaced by a
 * clean `DELETE /products` gated to SUPER_ADMIN.
 */
@Controller('products')
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @BusinessPermission(Permission.WRITE, { param: 'businessId' })
  @Post(':businessId/product')
  create(
    @Param('businessId') businessId: string,
    @Body() dto: ProductRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.products.createProduct(BigInt(businessId), dto, user);
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN) // every business's products
  @Get()
  getAll(@CurrentUser() user: AuthUser) {
    return this.products.getAllProducts(user);
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get('paginated-products')
  paginated(
    @Query('page') page = '0',
    @Query('size') size = '10',
    @CurrentUser() user: AuthUser,
  ) {
    return this.products.getAllProductsPaginated(
      Number(page) || 0,
      Number(size) || 10,
      user,
    );
  }

  @BusinessPermission(Permission.VIEW, { param: 'businessId' })
  @Get(':businessId/business-products')
  forBusiness(@Param('businessId') businessId: string) {
    return this.products.getProductsForBusiness(BigInt(businessId));
  }

  @BusinessPermission(Permission.VIEW, {
    resource: 'product',
    idParam: 'productId',
  })
  @Get(':productId')
  getOne(@Param('productId') productId: string) {
    return this.products.getProduct(BigInt(productId));
  }

  @BusinessPermission(Permission.WRITE, {
    resource: 'product',
    idParam: 'productId',
    param: 'businessId',
  })
  @Put(':businessId/:productId')
  update(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
    @Body() dto: ProductRequestDto,
  ) {
    return this.products.updateProduct(
      BigInt(businessId),
      BigInt(productId),
      dto,
    );
  }

  @BusinessPermission(Permission.WRITE, {
    resource: 'product',
    idParam: 'productId',
    param: 'businessId',
  })
  @Post('toggle-product/:businessId/:productId')
  toggle(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    return this.products.toggleProductStatus(
      BigInt(businessId),
      BigInt(productId),
    );
  }

  @Delete()
  @Roles(Role.SUPER_ADMIN)
  deleteAll() {
    return this.products.deleteAllProducts();
  }

  @Delete(':productId')
  @BusinessPermission(Permission.DELETE, {
    resource: 'product',
    idParam: 'productId',
  })
  remove(@Param('productId') productId: string) {
    return this.products.deleteProduct(BigInt(productId));
  }
}
