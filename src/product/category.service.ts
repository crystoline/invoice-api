import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { mapProductDTO } from './product.mapper';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  // 7.1 — admin only
  async createCategory(name: string | undefined, description: string | undefined, user: AuthUser): Promise<ResponseObject> {
    if (!user.roles.includes(Role.ADMIN)) {
      return fail('Failed to create Category: Only Admin privilege can perform this action');
    }
    try {
      const cat = await this.prisma.categories.create({ data: { name: name as string, description } });
      return ok('Category created successfully', { categoryId: cat.id, name: cat.name, description: cat.description });
    } catch (e) {
      return fail(`Failed to create Category: ${(e as Error).message}`);
    }
  }

  // 7.2 — any auth
  async addProductToCategory(categoryId: bigint, productId: bigint): Promise<ResponseObject> {
    try {
      const cat = await this.prisma.categories.findUnique({ where: { id: categoryId } });
      if (!cat) throw new Error('Category not found');
      const product = await this.prisma.products.findUnique({ where: { id: productId } });
      if (!product) throw new Error('Product not found');
      const updated = await this.prisma.products.update({ where: { id: productId }, data: { category_id: categoryId } });
      return ok('Product added to category successfully', mapProductDTO(updated));
    } catch (e) {
      return fail(`Failed to add product to Category: ${(e as Error).message}`);
    }
  }

  // 7.3 — owner or member
  async getProductsByCategoryForBusiness(categoryId: bigint, businessId: bigint, user: AuthUser): Promise<ResponseObject> {
    const business = await this.prisma.businesses.findUnique({
      where: { id: businessId },
      include: { business_members: true },
    });
    if (!business) throw new Error('Business not found');
    const category = await this.prisma.categories.findUnique({ where: { id: categoryId } });
    if (!category) throw new Error('Category not found');
    const isOwner = business.owner_id === user.id;
    const isMember = business.business_members.some((m) => m.user_id === user.id);
    if (!isOwner && !isMember) return fail('Failed to fetch Business Category products: You need to belong to this business');
    try {
      const products = await this.prisma.products.findMany({ where: { business_id: businessId, category_id: categoryId } });
      return ok('Category products fetched successfully', products.map(mapProductDTO));
    } catch (e) {
      return fail(`Failed to fetch Business Category products: ${(e as Error).message}`);
    }
  }

  // 7.4 — any auth
  async getCategories(): Promise<ResponseObject> {
    try {
      const cats = await this.prisma.categories.findMany();
      return ok(
        'Categories fetched successfully',
        cats.map((c) => ({ categoryId: c.id, name: c.name, description: c.description })),
      );
    } catch (e) {
      return fail(`Failed to fetch Categories: ${(e as Error).message}`);
    }
  }
}
