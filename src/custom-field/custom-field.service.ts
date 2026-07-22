import { Injectable } from '@nestjs/common';
import { invoice_custom_fields } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { InvoiceConfigRequestDto } from './dto/custom-field.dto';

@Injectable()
export class CustomFieldService {
  constructor(private readonly prisma: PrismaService) {}

  private map(c: invoice_custom_fields) {
    return {
      id: c.id,
      customName: c.custom_name,
      customer: c.customer,
      invoiceNumber: c.invoice_number,
      totalAmount: c.total_amount,
      invoiceDate: c.invoice_date,
      isRecurring: c.is_recurring,
      frequency: c.frequency,
      product: c.product,
      price: c.price,
      quantity: c.quantity,
    };
  }

  private toData(dto: InvoiceConfigRequestDto) {
    return {
      custom_name: dto.customName,
      customer: dto.customer,
      invoice_number: dto.invoiceNumber,
      total_amount: dto.totalAmount,
      invoice_date: dto.invoiceDate,
      is_recurring: dto.isRecurring,
      frequency: dto.frequency,
      product: dto.product,
      price: dto.price,
      quantity: dto.quantity,
    };
  }

  async create(dto: InvoiceConfigRequestDto, userId: bigint): Promise<ResponseObject> {
    const created = await this.prisma.invoice_custom_fields.create({
      data: { ...this.toData(dto), user_id: userId },
    });
    return ok('Custom fields created successfully', this.map(created));
  }

  async getAllForOwner(userId: bigint): Promise<ResponseObject> {
    try {
      const items = await this.prisma.invoice_custom_fields.findMany({ where: { user_id: userId } });
      return ok('Custom configs fetched successfully', items.map((c) => this.map(c)));
    } catch (e) {
      return fail(`Failed to fetch Custom configs for user ${(e as Error).message}`);
    }
  }

  async getById(configId: bigint, userId: bigint): Promise<ResponseObject> {
    try {
      const config = await this.prisma.invoice_custom_fields.findUnique({ where: { id: configId } });
      if (!config) throw new Error('not found');
      if (config.user_id !== userId) {
        return fail('Failed to fetch Custom configs for user, configuration belongs to a different user ');
      }
      return ok('Custom config fetched successfully', this.map(config));
    } catch (e) {
      return fail(`Failed to fetch Custom config for user ${(e as Error).message}`);
    }
  }

  async update(configId: bigint, dto: InvoiceConfigRequestDto, userId: bigint): Promise<ResponseObject> {
    const config = await this.prisma.invoice_custom_fields.findUnique({ where: { id: configId } });
    if (!config || config.user_id !== userId) {
      return fail('Cannot update, configuration belongs to a different user ');
    }
    const updated = await this.prisma.invoice_custom_fields.update({
      where: { id: configId },
      data: this.toData(dto),
    });
    return ok('Custom fields updated successfully', this.map(updated));
  }

  async remove(configId: bigint, userId: bigint): Promise<ResponseObject> {
    const config = await this.prisma.invoice_custom_fields.findUnique({ where: { id: configId } });
    if (!config || config.user_id !== userId) {
      return fail('Cannot delete, configuration belongs to a different user ');
    }
    await this.prisma.invoice_custom_fields.delete({ where: { id: configId } });
    return ok('Custom field deleted successfully');
  }
}
