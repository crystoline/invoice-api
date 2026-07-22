import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, bill_items, bills } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { BillRequestDto } from './dto/bills.dto';

const billInclude = { bill_billitems: { include: { bill_items: true } } } satisfies Prisma.billsInclude;
type BillWithItems = Prisma.billsGetPayload<{ include: typeof billInclude }>;

const num = (d: Prisma.Decimal | null): number | null => (d != null ? Number(d) : null);

@Injectable()
export class BillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  private mapDTO(bill: bills, items: bill_items[]) {
    return {
      id: bill.id,
      totalAmount: num(bill.total_amount),
      billNumber: bill.bill_number,
      isPaid: bill.is_paid,
      billingUserId: bill.billing_user_id ?? null,
      billingVendorId: bill.billing_vendor_id ?? null,
      receiptUrl: bill.receipt_url,
      items: items.map((bi) => ({ id: bi.id, price: num(bi.price), quantity: bi.quantity, description: bi.description })),
    };
  }

  private itemsOf(bill: BillWithItems): bill_items[] {
    return bill.bill_billitems.map((bb) => bb.bill_items);
  }

  private async createItems(billId: bigint, items: BillRequestDto['items']): Promise<void> {
    for (const it of items ?? []) {
      if (it.productId == null) continue; // bill_items.product_id is required
      const bi = await this.prisma.bill_items.create({
        data: { price: it.price, quantity: it.quantity ?? 0, description: it.description, product_id: BigInt(it.productId) },
      });
      await this.prisma.bill_billitems.create({ data: { bill_id: billId, billitems_id: bi.id } });
    }
  }

  // POST /bills/bill — record a bill for a business against a vendor.
  // The bill is scoped to the business and "billed" to the current user (the
  // person recording it); the vendor is the party billing the business.
  async createBill(dto: BillRequestDto, user: AuthUser): Promise<ResponseObject> {
    try {
      if (dto.businessId == null) throw new Error('businessId is required');
      const business = await this.prisma.businesses.findUnique({ where: { id: BigInt(dto.businessId) } });
      if (!business) throw new Error('Business not found');

      let vendorId: bigint | null = null;
      if (dto.vendorId != null) {
        const vendor = await this.prisma.vendors.findUnique({ where: { id: BigInt(dto.vendorId) } });
        if (!vendor) throw new Error('Vendor not found');
        vendorId = vendor.id;
      }

      const bill = await this.prisma.bills.create({
        data: {
          bill_number: dto.billNumber,
          total_amount: dto.totalAmount,
          is_paid: dto.isPaid ?? false,
          business_id: business.id,
          billing_vendor_id: vendorId,
          billed_user_id: user.id,
        },
      });
      await this.createItems(bill.id, dto.items);
      return ok('Bill added Successfully', {
        id: bill.id,
        totalAmount: num(bill.total_amount),
        billNumber: bill.bill_number,
        isPaid: bill.is_paid,
        receiptUrl: bill.receipt_url,
      });
    } catch (e) {
      return fail(`Failed to add Bill: ${(e as Error).message}`);
    }
  }

  async markAsPaid(billId: bigint): Promise<ResponseObject> {
    try {
      const bill = await this.prisma.bills.findUnique({ where: { id: billId }, include: billInclude });
      if (!bill) throw new Error('Bill not found');
      const updated = await this.prisma.bills.update({ where: { id: billId }, data: { is_paid: true } });
      return ok('Bill marked as paid', this.mapDTO(updated, this.itemsOf(bill)));
    } catch (e) {
      return fail(`Bill not marked as paid: ${(e as Error).message}`);
    }
  }

  async getAllBills(): Promise<ResponseObject> {
    try {
      const bills = await this.prisma.bills.findMany({ include: billInclude });
      return ok('Bills fetched Successfully', bills.map((b) => this.mapDTO(b, this.itemsOf(b))));
    } catch (e) {
      return fail(`Failed to fetch Bills: ${(e as Error).message}`);
    }
  }

  async getByBusiness(businessId: bigint): Promise<ResponseObject> {
    try {
      const bills = await this.prisma.bills.findMany({ where: { business_id: businessId }, include: billInclude });
      return ok('Bills fetched successfully', bills.map((b) => this.mapDTO(b, this.itemsOf(b))));
    } catch (e) {
      return fail(`Failed to fetch bills: ${(e as Error).message}`);
    }
  }

  async getById(billId: bigint): Promise<ResponseObject> {
    try {
      const bill = await this.prisma.bills.findUnique({ where: { id: billId }, include: billInclude });
      if (!bill) throw new Error('Bill not found');
      return ok('Bill fetched successfully', this.mapDTO(bill, this.itemsOf(bill)));
    } catch (e) {
      return fail(`Failed to fetch Bill: ${(e as Error).message}`);
    }
  }

  async remove(billId: bigint): Promise<ResponseObject> {
    try {
      const exists = await this.prisma.bills.findUnique({ where: { id: billId } });
      if (!exists) return fail('Bill not found');
      const joins = await this.prisma.bill_billitems.findMany({ where: { bill_id: billId } });
      await this.prisma.bill_billitems.deleteMany({ where: { bill_id: billId } });
      await this.prisma.bill_items.deleteMany({ where: { id: { in: joins.map((j) => j.billitems_id) } } });
      await this.prisma.bills.delete({ where: { id: billId } });
      return ok('Bill deleted successfully');
    } catch (e) {
      return fail(`Failed to delete bill: ${(e as Error).message}`);
    }
  }

  async update(billId: bigint, dto: BillRequestDto): Promise<ResponseObject> {
    try {
      const existing = await this.prisma.bills.findUnique({ where: { id: billId } });
      if (!existing) throw new Error('Bill not found');
      await this.prisma.bills.update({
        where: { id: billId },
        data: { bill_number: dto.billNumber ?? undefined, total_amount: dto.totalAmount ?? undefined },
      });
      if (dto.items) {
        const joins = await this.prisma.bill_billitems.findMany({ where: { bill_id: billId } });
        await this.prisma.bill_billitems.deleteMany({ where: { bill_id: billId } });
        await this.prisma.bill_items.deleteMany({ where: { id: { in: joins.map((j) => j.billitems_id) } } });
        await this.createItems(billId, dto.items);
      }
      const reloaded = await this.prisma.bills.findUnique({ where: { id: billId }, include: billInclude });
      return ok('Bill updated successfully', this.mapDTO(reloaded!, this.itemsOf(reloaded!)));
    } catch (e) {
      return fail(`Failed to update bill: ${(e as Error).message}`);
    }
  }

  async uploadReceipt(billId: bigint, file: Express.Multer.File): Promise<ResponseObject> {
    try {
      const bill = await this.prisma.bills.findUnique({ where: { id: billId }, include: billInclude });
      if (!bill) throw new Error('Bill not found');
      const relativePath = await this.storage.storeFile(file, 'receipts');
      const baseUrl = this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:8080';
      const receiptUrl = `${baseUrl}/uploads/${relativePath}`;
      const updated = await this.prisma.bills.update({ where: { id: billId }, data: { receipt_url: receiptUrl } });
      return ok('Receipt uploaded successfully', this.mapDTO(updated, this.itemsOf(bill)));
    } catch (e) {
      return fail(`Failed to upload receipt: ${(e as Error).message}`);
    }
  }
}
