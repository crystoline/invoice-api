import { Injectable } from '@nestjs/common';
import { expense_categories } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { ExpenseCategoryRequestDto } from './dto/expense-category.dto';

@Injectable()
export class ExpenseCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  private mapDTO(e: expense_categories) {
    return { id: e.id, name: e.name, description: e.description, color: e.color, businessId: e.business_id };
  }

  async create(dto: ExpenseCategoryRequestDto): Promise<ResponseObject> {
    try {
      const business = await this.prisma.businesses.findUnique({ where: { id: BigInt(dto.businessId ?? 0) } });
      if (!business) throw new Error('Business not found');
      const created = await this.prisma.expense_categories.create({
        data: { name: dto.name as string, description: dto.description, color: dto.color, business_id: business.id },
      });
      return ok('Expense category created successfully', this.mapDTO(created));
    } catch (e) {
      return fail(`Failed to create expense category: ${(e as Error).message}`);
    }
  }

  async getByBusiness(businessId: bigint): Promise<ResponseObject> {
    try {
      const items = await this.prisma.expense_categories.findMany({ where: { business_id: businessId } });
      return ok('Expense categories fetched successfully', items.map((e) => this.mapDTO(e)));
    } catch (e) {
      return fail(`Failed to fetch expense categories: ${(e as Error).message}`);
    }
  }

  async update(id: bigint, dto: ExpenseCategoryRequestDto): Promise<ResponseObject> {
    try {
      const existing = await this.prisma.expense_categories.findUnique({ where: { id } });
      if (!existing) throw new Error('Expense category not found');
      const updated = await this.prisma.expense_categories.update({
        where: { id },
        data: {
          name: dto.name ?? undefined,
          description: dto.description ?? undefined,
          color: dto.color ?? undefined,
        },
      });
      return ok('Expense category updated successfully', this.mapDTO(updated));
    } catch (e) {
      return fail(`Failed to update expense category: ${(e as Error).message}`);
    }
  }

  async remove(id: bigint): Promise<ResponseObject> {
    try {
      const existing = await this.prisma.expense_categories.findUnique({ where: { id } });
      if (!existing) return fail('Expense category not found');
      await this.prisma.expense_categories.delete({ where: { id } });
      return ok('Expense category deleted successfully');
    } catch (e) {
      return fail(`Failed to delete expense category: ${(e as Error).message}`);
    }
  }
}
