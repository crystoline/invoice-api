import { Module } from '@nestjs/common';
import { ProductController } from './product.controller';
import { CategoryController } from './category.controller';
import { ProductService } from './product.service';
import { CategoryService } from './category.service';

@Module({
  controllers: [ProductController, CategoryController],
  providers: [ProductService, CategoryService],
})
export class ProductModule {}
