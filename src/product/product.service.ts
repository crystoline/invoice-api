import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { toSpringPage } from '../common/dto/page';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { isPlatformAdmin } from '../common/authz/permissions';
import { ProductRequestDto } from './dto/product.dto';
import { mapProductDTO, mapProductEntity } from './product.mapper';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  // Business membership and role are enforced by AuthorizationGuard per route.
  private isAdmin(user: AuthUser): boolean {
    return isPlatformAdmin(user);
  }

  // 6.1 — WRITE (guard)
  async createProduct(
    businessId: bigint,
    dto: ProductRequestDto,
    _user: AuthUser,
  ): Promise<ResponseObject> {
    try {
      let categoryId: bigint | null = null;
      if (dto.categoryId != null) {
        const cat = await this.prisma.categories.findUnique({
          where: { id: BigInt(dto.categoryId) },
        });
        if (!cat) throw new Error('Category not found');
        categoryId = cat.id;
      }
      const business = await this.prisma.businesses.findUnique({
        where: { id: businessId },
      });
      if (!business) throw new Error('Business not found');
      const existing = await this.prisma.products.findFirst({
        where: { business_id: businessId, name: dto.name },
      });
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
      return fail(
        `Failed to create product for business====== ${(e as Error).message}`,
      );
    }
  }

  // 6.2 — admin only (fixed: returns data)
  async getAllProducts(user: AuthUser): Promise<ResponseObject> {
    if (!this.isAdmin(user))
      return fail(
        'Failed to fetch products, only an Admin can perform this action ',
      );
    try {
      const all = await this.prisma.products.findMany();
      return ok('All products fetched successfully', all.map(mapProductDTO));
    } catch (e) {
      return fail(`Failed to fetch products: ${(e as Error).message}`);
    }
  }

  // 6.3 — VIEW (guard; null-safe category)
  async getProductsForBusiness(businessId: bigint): Promise<ResponseObject> {
    const business = await this.prisma.businesses.findUnique({
      where: { id: businessId },
    });
    if (!business) throw new Error('Business not found');
    try {
      const products = await this.prisma.products.findMany({
        where: { business_id: businessId },
      });
      return ok(
        'Business products fetched successfully',
        products.map(mapProductDTO),
      );
    } catch (e) {
      return fail(
        `Failed to fetch Business  products: ${(e as Error).message}`,
      );
    }
  }

  // 6.4 — admin only
  async getAllProductsPaginated(
    page: number,
    size: number,
    user: AuthUser,
  ): Promise<ResponseObject> {
    if (!this.isAdmin(user))
      return fail(
        'Failed to fetch products, only an Admin can perform this action ',
      );
    try {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.products.findMany({ skip: page * size, take: size }),
        this.prisma.products.count(),
      ]);
      return ok(
        'All products paginated fetched successfully',
        toSpringPage(items.map(mapProductEntity), page, size, total),
      );
    } catch (e) {
      return fail(
        `Failed to fetch paginated products: ${(e as Error).message}`,
      );
    }
  }

  // 6.5 — VIEW (guard; 500 if not found, per legacy)
  async getProduct(productId: bigint): Promise<ResponseObject> {
    const product = await this.prisma.products.findUnique({
      where: { id: productId },
    });
    if (!product) throw new Error('Product not found');
    return ok('Product fetched', mapProductDTO(product));
  }

  // 6.6 — WRITE (guard checks the product belongs to businessId)
  async updateProduct(
    _businessId: bigint,
    productId: bigint,
    dto: ProductRequestDto,
  ): Promise<ResponseObject> {
    try {
      const exists = await this.prisma.products.findUnique({
        where: { id: productId },
      });
      if (!exists)
        return fail(`Product ${dto.name} does not exist, cannot be updated`);
      const updated = await this.prisma.products.update({
        where: { id: productId },
        data: {
          unit_price: dto.unitPrice,
          name: dto.name,
          is_product_active: dto.isProductActive,
        },
      });
      return ok('Product updated successfully', mapProductDTO(updated));
    } catch (e) {
      return fail(
        `Failed to update product ${dto.name} for business====== ${(e as Error).message}`,
      );
    }
  }

  // 6.7 — WRITE (guard)
  async toggleProductStatus(
    businessId: bigint,
    productId: bigint,
  ): Promise<ResponseObject> {
    const product = await this.prisma.products.findUnique({
      where: { id: productId },
    });
    if (!product) throw new Error('Product not found');
    const business = await this.prisma.businesses.findUnique({
      where: { id: businessId },
    });
    if (!business) throw new Error('Business not found');
    if (product.business_id !== businessId)
      return fail('Product does not belong to the specified business.');
    try {
      const updated = await this.prisma.products.update({
        where: { id: productId },
        data: { is_product_active: !product.is_product_active },
      });
      return ok('Product toggled successfully', mapProductDTO(updated));
    } catch (e) {
      return fail(
        `Failed to toggle product for business====== ${(e as Error).message}`,
      );
    }
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
