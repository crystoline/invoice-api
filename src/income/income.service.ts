import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { IncomeRequestDto } from './dto/income.dto';

const incomeInclude = { customers: true } satisfies Prisma.incomeInclude;
type IncomeWithCustomer = Prisma.incomeGetPayload<{ include: typeof incomeInclude }>;

const num = (d: Prisma.Decimal | null): number | null => (d != null ? Number(d) : null);
const ymd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

@Injectable()
export class IncomeService {
  constructor(private readonly prisma: PrismaService) {}

  private mapDTO(i: IncomeWithCustomer) {
    return {
      id: i.id,
      amount: num(i.amount),
      incomeDate: ymd(i.income_date),
      description: i.description,
      source: i.source,
      categoryName: i.category_name,
      businessId: i.business_id,
      customerId: i.customer_id,
      customerName: i.customers ? `${i.customers.first_name ?? ''} ${i.customers.last_name ?? ''}`.trim() : null,
    };
  }

  async create(dto: IncomeRequestDto): Promise<ResponseObject> {
    try {
      const business = await this.prisma.businesses.findUnique({ where: { id: BigInt(dto.businessId ?? 0) } });
      if (!business) throw new Error('Business not found');
      let customerId: bigint | null = null;
      if (dto.customerId != null) {
        const c = await this.prisma.customers.findUnique({ where: { id: BigInt(dto.customerId) } });
        if (!c) throw new Error('Customer not found');
        customerId = c.id;
      }
      const created = await this.prisma.income.create({
        data: {
          amount: dto.amount,
          income_date: dto.incomeDate ? new Date(dto.incomeDate) : null,
          description: dto.description,
          source: dto.source ?? 'MANUAL',
          category_name: dto.categoryName,
          business_id: business.id,
          customer_id: customerId,
        },
        include: incomeInclude,
      });
      return ok('Income created successfully', this.mapDTO(created));
    } catch (e) {
      return fail(`Failed to create income: ${(e as Error).message}`);
    }
  }

  async getByBusiness(businessId: bigint): Promise<ResponseObject> {
    try {
      const items = await this.prisma.income.findMany({
        where: { business_id: businessId },
        orderBy: { income_date: 'desc' },
        include: incomeInclude,
      });
      return ok('Income fetched successfully', items.map((i) => this.mapDTO(i)));
    } catch (e) {
      return fail(`Failed to fetch income: ${(e as Error).message}`);
    }
  }

  async update(id: bigint, dto: IncomeRequestDto): Promise<ResponseObject> {
    try {
      const existing = await this.prisma.income.findUnique({ where: { id } });
      if (!existing) throw new Error('Income not found');
      let customerId: bigint | undefined;
      if (dto.customerId != null) {
        const c = await this.prisma.customers.findUnique({ where: { id: BigInt(dto.customerId) } });
        if (!c) throw new Error('Customer not found');
        customerId = c.id;
      }
      const updated = await this.prisma.income.update({
        where: { id },
        data: {
          amount: dto.amount ?? undefined,
          income_date: dto.incomeDate ? new Date(dto.incomeDate) : undefined,
          description: dto.description ?? undefined,
          source: dto.source ?? undefined,
          category_name: dto.categoryName ?? undefined,
          customer_id: customerId,
        },
        include: incomeInclude,
      });
      return ok('Income updated successfully', this.mapDTO(updated));
    } catch (e) {
      return fail(`Failed to update income: ${(e as Error).message}`);
    }
  }

  async remove(id: bigint): Promise<ResponseObject> {
    try {
      const existing = await this.prisma.income.findUnique({ where: { id } });
      if (!existing) return fail('Income not found');
      await this.prisma.income.delete({ where: { id } });
      return ok('Income deleted successfully');
    } catch (e) {
      return fail(`Failed to delete income: ${(e as Error).message}`);
    }
  }
}
