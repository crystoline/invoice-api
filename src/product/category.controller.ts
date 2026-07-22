import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CategoryService } from './category.service';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { CategoryRequestDto } from './dto/product.dto';

/** CategoryController — `/api/categories`. */
@Controller('categories')
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Post('category')
  create(@Body() dto: CategoryRequestDto, @CurrentUser() user: AuthUser) {
    return this.categories.createCategory(dto.name, dto.description, user);
  }

  @Post(':categoryId/:productId')
  addProduct(@Param('categoryId') categoryId: string, @Param('productId') productId: string) {
    return this.categories.addProductToCategory(BigInt(categoryId), BigInt(productId));
  }

  @Get(':businessId/:categoryId/products')
  byCategory(@Param('businessId') businessId: string, @Param('categoryId') categoryId: string, @CurrentUser() user: AuthUser) {
    return this.categories.getProductsByCategoryForBusiness(BigInt(categoryId), BigInt(businessId), user);
  }

  @Get()
  getAll() {
    return this.categories.getCategories();
  }
}
