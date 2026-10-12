import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CategoryService } from './category.service';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { CategoryRequestDto } from './dto/product.dto';
import {
  Authenticated,
  BusinessPermission,
} from '../common/authz/authz.decorators';
import { Permission } from '../common/authz/permissions';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

/** CategoryController — `/api/categories`. */
@Controller('categories')
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Roles(Role.ADMIN, Role.SUPER_ADMIN) // categories are a shared, platform-wide taxonomy
  @Post('category')
  create(@Body() dto: CategoryRequestDto, @CurrentUser() user: AuthUser) {
    return this.categories.createCategory(dto.name, dto.description, user);
  }

  @BusinessPermission(Permission.WRITE, {
    resource: 'product',
    idParam: 'productId',
  })
  @Post(':categoryId/:productId')
  addProduct(
    @Param('categoryId') categoryId: string,
    @Param('productId') productId: string,
  ) {
    return this.categories.addProductToCategory(
      BigInt(categoryId),
      BigInt(productId),
    );
  }

  @BusinessPermission(Permission.VIEW, { param: 'businessId' })
  @Get(':businessId/:categoryId/products')
  byCategory(
    @Param('businessId') businessId: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.categories.getProductsByCategoryForBusiness(
      BigInt(categoryId),
      BigInt(businessId),
    );
  }

  @Authenticated() // read-only shared taxonomy
  @Get()
  getAll() {
    return this.categories.getCategories();
  }
}
