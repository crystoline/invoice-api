import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { toSpringPage } from '../common/dto/page';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { ProductRequestDto } from './dto/product.dto';
import { mapProductDTO, mapProductEntity } from './product.mapper';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  private isAdmin(user: AuthUser): boolean {
    return user.roles.includes(Role.ADMIN);
  }

  // 6.1 — any authenticated user
  async createProduct(businessId: bigint, dto: ProductRequestDto, _user: AuthUser): Promise<ResponseObject> {
    try {
      let categoryId: bigint | null = null;
      if (dto.categoryId != null) {
        const cat = await this.prisma.categories.findUnique({ where: { id: BigInt(dto.categoryId) } });
        if (!cat) throw new Error('Category not found');
        categoryId = cat.id;
      }
      const business = await this.prisma.businesses.findUnique({ where: { id: businessId } });
      if (!business) throw new Error('Business not found');
      const existing = await this.prisma.products.findFirst({ where: { business_id: businessId, name: dto.name } });
      if (existing) return fail('This Product already exists');
      const created = await this.prisma.products.create({
        data: {
          name: dto.name,
          unit_price: dto.unitPrice,
          is_product_active: true,
          category_id: categoryId,
          business_id: businessId,
        },
      });
      return ok('Product created successfully', mapProductDTO(created));
    } catch (e) {
      return fail(`Failed to create product for business====== ${(e as Error).message}`);
    }
  }

  // 6.2 — admin only (fixed: returns data)
  async getAllProducts(user: AuthUser): Promise<ResponseObject> {
    if (!this.isAdmin(user)) return fail('Failed to fetch products, only an Admin can perform this action ');
    try {
      const all = await this.prisma.products.findMany();
      return ok('All products fetched successfully', all.map(mapProductDTO));
    } catch (e) {
      return fail(`Failed to fetch products: ${(e as Error).message}`);
    }
  }

  // 6.3 — owner or member (null-safe category)
  async getProductsForBusiness(businessId: bigint, user: AuthUser): Promise<ResponseObject> {
    const business = await this.prisma.businesses.findUnique({
      where: { id: businessId },
      include: { business_members: true },
    });
    if (!business) throw new Error('Business not found');
    const isOwner = business.owner_id === user.id;
    const isMember = business.business_members.some((m) => m.user_id === user.id);
    if (!isOwner && !isMember) return fail('Failed to fetch Business  products: You need to belong to this business');
    try {
      const products = await this.prisma.products.findMany({ where: { business_id: businessId } });
      return ok('Business products fetched successfully', products.map(mapProductDTO));
    } catch (e) {
      return fail(`Failed to fetch Business  products: ${(e as Error).message}`);
    }
  }

  // 6.4 — admin only
  async getAllProductsPaginated(page: number, size: number, user: AuthUser): Promise<ResponseObject> {
    if (!this.isAdmin(user)) return fail('Failed to fetch products, only an Admin can perform this action ');
    try {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.products.findMany({ skip: page * size, take: size }),
        this.prisma.products.count(),
      ]);
      return ok('All products paginated fetched successfully', toSpringPage(items.map(mapProductEntity), page, size, total));
    } catch (e) {
      return fail(`Failed to fetch paginated products: ${(e as Error).message}`);
    }
  }

  // 6.5 — any auth (500 if not found, per legacy)
  async getProduct(productId: bigint): Promise<ResponseObject> {
    const product = await this.prisma.products.findUnique({ where: { id: productId } });
    if (!product) throw new Error('Product not found');
    return ok('Product fetched', mapProductDTO(product));
  }

  // 6.6 — any auth (businessId unused, per legacy)
  async updateProduct(_businessId: bigint, productId: bigint, dto: ProductRequestDto): Promise<ResponseObject> {
    try {
      const exists = await this.prisma.products.findUnique({ where: { id: productId } });
      if (!exists) return fail(`Product ${dto.name} does not exist, cannot be updated`);
      const updated = await this.prisma.products.update({
        where: { id: productId },
        data: { unit_price: dto.unitPrice, name: dto.name, is_product_active: dto.isProductActive },
      });
      return ok('Product updated successfully', mapProductDTO(updated));
    } catch (e) {
      return fail(`Failed to update product ${dto.name} for business====== ${(e as Error).message}`);
    }
  }

  // 6.7 — owner or admin
  async toggleProductStatus(businessId: bigint, productId: bigint, user: AuthUser): Promise<ResponseObject> {
    const product = await this.prisma.products.findUnique({ where: { id: productId } });
    if (!product) throw new Error('Product not found');
    const business = await this.prisma.businesses.findUnique({ where: { id: businessId } });
    if (!business) throw new Error('Business not found');
    if (product.business_id !== businessId) return fail('Product does not belong to the specified business.');
    if (business.owner_id === user.id || this.isAdmin(user)) {
      try {
        const updated = await this.prisma.products.update({
          where: { id: productId },
          data: { is_product_active: !product.is_product_active },
        });
        return ok('Product toggled successfully', mapProductDTO(updated));
      } catch (e) {
        return fail(`Failed to toggle product for business====== ${(e as Error).message}`);
      }
    }
    return fail('Failed to fetch products, only an Admin can perform this action ');
  }

  // 6.8 — destructive; clean path, SUPER_ADMIN at controller (no wrong-table reset)
  async deleteAllProducts(): Promise<ResponseObject> {
    await this.prisma.products.deleteMany({});
    return ok('Products deleted successfully.');
  }

  // 6.9 — hardened to ADMIN at controller
  async deleteProduct(productId: bigint): Promise<ResponseObject> {
    await this.prisma.products.delete({ where: { id: productId } });
    return ok('Products deleted successfully.');
  }
}
