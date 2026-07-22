import { Injectable } from '@nestjs/common';
import { Prisma, vendor_products, vendors } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { VendorRequestDto, VendorProductRequestDto } from './dto/vendor.dto';

const num = (d: Prisma.Decimal | null): number | null => (d != null ? Number(d) : null);

@Injectable()
export class VendorService {
  constructor(private readonly prisma: PrismaService) {}

  private mapVendor(v: vendors) {
    return { id: v.id, name: v.name, email: v.email, status: v.status };
  }

  private mapVendorProduct(vp: vendor_products) {
    return {
      id: vp.id,
      vendorProductName: vp.vendor_product_name,
      vendorProductPrice: num(vp.vendor_product_price),
      vendorProductStatus: vp.vendor_product_status,
      vendorId: vp.vendor_id,
    };
  }

  // 4.1
  async createVendor(dto: VendorRequestDto): Promise<ResponseObject> {
    try {
      if (dto.email && (await this.prisma.vendors.findFirst({ where: { email: dto.email } }))) {
        return fail('This email is already registered as a vendor');
      }
      const v = await this.prisma.vendors.create({ data: { email: dto.email, name: dto.name, status: dto.status } });
      return ok('Vendor added successfully', this.mapVendor(v));
    } catch (e) {
      return fail(`Failed  to add Vendor: ${(e as Error).message}`);
    }
  }

  // 4.2 — clean list path (fixed double-setResponseCode → proper 00)
  async getAllVendors(): Promise<ResponseObject> {
    const all = await this.prisma.vendors.findMany();
    return ok('Vendors fetched successfully', all.map((v) => this.mapVendor(v)));
  }

  // 4.3
  async getVendorById(id: bigint): Promise<ResponseObject> {
    try {
      const vendor = await this.prisma.vendors.findUnique({ where: { id } });
      if (!vendor) throw new Error('Vendor not found');
      return ok('Vendor fetched successfully', this.mapVendor(vendor));
    } catch (e) {
      return fail(`Failed  to fetch Vendor: ${(e as Error).message}`);
    }
  }

  // 4.4
  async updateVendor(id: bigint, dto: VendorRequestDto): Promise<ResponseObject> {
    try {
      const updated = await this.prisma.vendors.update({
        where: { id },
        data: { name: dto.name, email: dto.email, status: dto.status },
      });
      return ok('Vendor updated successfully', this.mapVendor(updated));
    } catch (e) {
      return fail(`Failed  to update Vendor: ${(e as Error).message}`);
    }
  }

  // 4.5 — idempotent delete (legacy 500s on missing id; hardened to no-op)
  async deleteVendor(id: bigint): Promise<ResponseObject> {
    await this.prisma.vendors.deleteMany({ where: { id } });
    return ok('Vendor deleted successfully.');
  }

  // 4.6 — owning side set (fixes legacy NPE)
  async addVendorProduct(vendorId: bigint, dto: VendorProductRequestDto): Promise<ResponseObject> {
    try {
      const vendor = await this.prisma.vendors.findUnique({ where: { id: vendorId } });
      if (!vendor) throw new Error('Vendor not found');
      const vp = await this.prisma.vendor_products.create({
        data: {
          vendor_product_name: dto.vendorProductName,
          vendor_product_price: dto.vendorProductPrice,
          vendor_product_status: dto.vendorProductStatus,
          vendor_id: vendorId,
        },
      });
      return ok('Vendor product added successfully', this.mapVendorProduct(vp));
    } catch (e) {
      return fail(`Failed  to add vendor product: ${(e as Error).message}`);
    }
  }

  // 4.7 — fixed double-setResponseCode
  async getVendorProductsByVendorId(vendorId: bigint): Promise<ResponseObject> {
    const items = await this.prisma.vendor_products.findMany({ where: { vendor_id: vendorId } });
    return ok("Vendor's products fetched successfully", items.map((vp) => this.mapVendorProduct(vp)));
  }

  // 4.8 — path var is the vendor-PRODUCT id
  async updateVendorProduct(vendorProductId: bigint, dto: VendorProductRequestDto): Promise<ResponseObject> {
    try {
      const updated = await this.prisma.vendor_products.update({
        where: { id: vendorProductId },
        data: {
          vendor_product_name: dto.vendorProductName,
          vendor_product_price: dto.vendorProductPrice,
          vendor_product_status: dto.vendorProductStatus,
        },
      });
      return ok('Vendor product updated successfully', this.mapVendorProduct(updated));
    } catch (e) {
      return fail(`Failed  to update vendor product: ${(e as Error).message}`);
    }
  }

  // 4.9 — returns a DTO (not the raw recursive entity)
  async toggleVendor(vendorId: bigint): Promise<ResponseObject> {
    try {
      const vendor = await this.prisma.vendors.findUnique({ where: { id: vendorId } });
      if (!vendor) throw new Error('Vendor not found');
      const updated = await this.prisma.vendors.update({
        where: { id: vendorId },
        data: { status: !vendor.status },
      });
      return ok('Vendor status toggled successfully', this.mapVendor(updated));
    } catch (e) {
      return fail(`Failed  to toggle vendor status: ${(e as Error).message}`);
    }
  }
}
