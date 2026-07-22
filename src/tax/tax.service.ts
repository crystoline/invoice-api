import { Injectable } from '@nestjs/common';
import { tax_rates } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { CreateTaxRateDto, UpdateTaxRateDto } from './dto/tax-rate.dto';

@Injectable()
export class TaxService {
  constructor(private readonly prisma: PrismaService) {}

  private mapDTO(t: tax_rates) {
    return {
      id: t.id,
      businessId: t.business_id,
      name: t.name,
      rate: t.rate != null ? Number(t.rate) : null,
      isDefault: t.is_default,
      createdAt: t.created_at,
    };
  }

  async create(dto: CreateTaxRateDto): Promise<ResponseObject> {
    try {
      const businessId = BigInt(dto.businessId ?? 0);
      if (dto.isDefault) {
        await this.prisma.tax_rates.updateMany({
          where: { business_id: businessId },
          data: { is_default: false },
        });
      }
      const created = await this.prisma.tax_rates.create({
        data: {
          business_id: businessId,
          name: dto.name,
          rate: dto.rate,
          is_default: dto.isDefault ?? false,
        },
      });
      return ok('Tax rate created successfully', this.mapDTO(created));
    } catch (e) {
      return fail(`Failed to create tax rate: ${(e as Error).message}`);
    }
  }

  async getByBusiness(businessId: bigint): Promise<ResponseObject> {
    try {
      const items = await this.prisma.tax_rates.findMany({ where: { business_id: businessId } });
      return ok('Tax rates fetched successfully', items.map((t) => this.mapDTO(t)));
    } catch (e) {
      return fail(`Failed to fetch tax rates: ${(e as Error).message}`);
    }
  }

  async update(id: bigint, dto: UpdateTaxRateDto): Promise<ResponseObject> {
    try {
      const existing = await this.prisma.tax_rates.findUnique({ where: { id } });
      if (!existing) return fail('Tax rate not found');
      if (dto.isDefault && existing.business_id != null) {
        await this.prisma.tax_rates.updateMany({
          where: { business_id: existing.business_id, id: { not: id } },
          data: { is_default: false },
        });
      }
      const updated = await this.prisma.tax_rates.update({
        where: { id },
        data: {
          name: dto.name ?? undefined,
          rate: dto.rate ?? undefined,
          is_default: dto.isDefault ?? undefined,
        },
      });
      return ok('Tax rate updated successfully', this.mapDTO(updated));
    } catch (e) {
      return fail(`Failed to update tax rate: ${(e as Error).message}`);
    }
  }

  async remove(id: bigint): Promise<ResponseObject> {
    try {
      const existing = await this.prisma.tax_rates.findUnique({ where: { id } });
      if (!existing) return fail('Tax rate not found');
      await this.prisma.tax_rates.delete({ where: { id } });
      return ok('Tax rate deleted successfully');
    } catch (e) {
      return fail(`Failed to delete tax rate: ${(e as Error).message}`);
    }
  }
}
