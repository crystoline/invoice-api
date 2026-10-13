import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RECEIPT_TYPES, StorageService } from '../storage/storage.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { BillRequestDto } from './dto/bills.dto';

const billInclude = {
  // Join rows are created in entry order, so ordering by them keeps the lines
  // in the order the user typed them.
  bill_billitems: {
    include: { bill_items: true },
    orderBy: { billitems_id: 'asc' },
  },
  vendors: true,
} satisfies Prisma.billsInclude;
type BillWithItems = Prisma.billsGetPayload<{ include: typeof billInclude }>;

const num = (d: Prisma.Decimal | null): number | null =>
  d != null ? Number(d) : null;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A bill line, normalised from the request. */
interface BillLine {
  description: string | null;
  quantity: number;
  price: number;
  product_id: bigint | null;
}

/** Normalise request lines; rows with neither a description nor a product are dropped. */
const toLines = (items: BillRequestDto['items']): BillLine[] =>
  (items ?? [])
    .map((it) => ({
      description: it.description?.trim() || null,
      quantity: it.quantity ?? 1,
      price: it.price ?? 0,
      product_id: it.productId != null ? BigInt(it.productId) : null,
    }))
    .filter((l) => l.description != null || l.product_id != null);

const linesTotal = (lines: BillLine[]): number =>
  round2(lines.reduce((sum, l) => sum + l.quantity * l.price, 0));

/** Nested write that creates each line plus its bill_billitems join row. */
const linesCreate = (lines: BillLine[]) => ({
  create: lines.map((l) => ({ bill_items: { create: l } })),
});

@Injectable()
export class BillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  private mapDTO(bill: BillWithItems) {
    return {
      id: bill.id,
      businessId: bill.business_id ?? null,
      totalAmount: num(bill.total_amount),
      billNumber: bill.bill_number,
      isPaid: bill.is_paid,
      billingUserId: bill.billing_user_id ?? null,
      billingVendorId: bill.billing_vendor_id ?? null,
      vendorName: bill.vendors?.name ?? null,
      // The stored file isn't public; this authorized route serves it.
      receiptUrl: bill.receipt_url
        ? `${this.apiBase()}/api/bills/bill/${bill.id}/receipt`
        : null,
      hasReceipt: !!bill.receipt_url,
      createdAt: bill.created_at,
      items: bill.bill_billitems.map(({ bill_items: bi }) => ({
        id: bi.id,
        productId: bi.product_id ?? null,
        description: bi.description,
        quantity: bi.quantity,
        price: num(bi.price),
        amount: round2((num(bi.price) ?? 0) * bi.quantity),
      })),
    };
  }

  /** Delete a bill's lines and their join rows (join rows first — they hold the FKs). */
  private async deleteItems(
    tx: Prisma.TransactionClient,
    billId: bigint,
  ): Promise<void> {
    const joins = await tx.bill_billitems.findMany({
      where: { bill_id: billId },
    });
    await tx.bill_billitems.deleteMany({ where: { bill_id: billId } });
    await tx.bill_items.deleteMany({
      where: { id: { in: joins.map((j) => j.billitems_id) } },
    });
  }

  /** Lines may link catalogue products — only the bill's own business's. */
  private async assertProductsIn(
    lines: BillLine[],
    businessId: bigint | null,
  ): Promise<void> {
    const ids = [
      ...new Set(lines.flatMap((l) => (l.product_id ? [l.product_id] : []))),
    ];
    if (!ids.length) return;
    const found = await this.prisma.products.count({
      where: { id: { in: ids }, business_id: businessId ?? undefined },
    });
    if (businessId == null || found !== ids.length)
      throw new Error('Product not found');
  }

  // POST /bills/bill — record a bill for a business against a vendor.
  // The bill is scoped to the business and "billed" to the current user (the
  // person recording it); the vendor is the party billing the business.
  async createBill(
    dto: BillRequestDto,
    user: AuthUser,
  ): Promise<ResponseObject> {
    try {
      if (dto.businessId == null) throw new Error('businessId is required');
      const business = await this.prisma.businesses.findUnique({
        where: { id: BigInt(dto.businessId) },
      });
      if (!business) throw new Error('Business not found');

      let vendorId: bigint | null = null;
      if (dto.vendorId != null) {
        const vendor = await this.prisma.vendors.findUnique({
          where: { id: BigInt(dto.vendorId) },
        });
        if (!vendor || vendor.business_id !== business.id)
          throw new Error('Vendor not found');
        vendorId = vendor.id;
      }

      // With lines, the total is their sum (never trust a client total);
      // without, fall back to the legacy single-amount bill.
      const lines = toLines(dto.items);
      await this.assertProductsIn(lines, business.id);
      const bill = await this.prisma.bills.create({
        data: {
          bill_number: dto.billNumber,
          total_amount: lines.length ? linesTotal(lines) : dto.totalAmount,
          is_paid: dto.isPaid ?? false,
          business_id: business.id,
          billing_vendor_id: vendorId,
          billed_user_id: user.id,
          bill_billitems: linesCreate(lines),
        },
        include: billInclude,
      });
      return ok('Bill added Successfully', this.mapDTO(bill));
    } catch (e) {
      return fail(`Failed to add Bill: ${(e as Error).message}`);
    }
  }

  async markAsPaid(billId: bigint): Promise<ResponseObject> {
    try {
      const bill = await this.prisma.bills.findUnique({
        where: { id: billId },
      });
      if (!bill) throw new Error('Bill not found');
      const updated = await this.prisma.bills.update({
        where: { id: billId },
        data: { is_paid: true },
        include: billInclude,
      });
      return ok('Bill marked as paid', this.mapDTO(updated));
    } catch (e) {
      return fail(`Bill not marked as paid: ${(e as Error).message}`);
    }
  }

  async getAllBills(): Promise<ResponseObject> {
    try {
      const bills = await this.prisma.bills.findMany({ include: billInclude });
      return ok(
        'Bills fetched Successfully',
        bills.map((b) => this.mapDTO(b)),
      );
    } catch (e) {
      return fail(`Failed to fetch Bills: ${(e as Error).message}`);
    }
  }

  async getByBusiness(businessId: bigint): Promise<ResponseObject> {
    try {
      const bills = await this.prisma.bills.findMany({
        where: { business_id: businessId },
        include: billInclude,
      });
      return ok(
        'Bills fetched successfully',
        bills.map((b) => this.mapDTO(b)),
      );
    } catch (e) {
      return fail(`Failed to fetch bills: ${(e as Error).message}`);
    }
  }

  async getById(billId: bigint): Promise<ResponseObject> {
    try {
      const bill = await this.prisma.bills.findUnique({
        where: { id: billId },
        include: billInclude,
      });
      if (!bill) throw new Error('Bill not found');
      return ok('Bill fetched successfully', this.mapDTO(bill));
    } catch (e) {
      return fail(`Failed to fetch Bill: ${(e as Error).message}`);
    }
  }

  async remove(billId: bigint): Promise<ResponseObject> {
    try {
      const exists = await this.prisma.bills.findUnique({
        where: { id: billId },
      });
      if (!exists) return fail('Bill not found');
      await this.prisma.$transaction(async (tx) => {
        await this.deleteItems(tx, billId);
        await tx.bills.delete({ where: { id: billId } });
      });
      return ok('Bill deleted successfully');
    } catch (e) {
      return fail(`Failed to delete bill: ${(e as Error).message}`);
    }
  }

  async update(billId: bigint, dto: BillRequestDto): Promise<ResponseObject> {
    try {
      const existing = await this.prisma.bills.findUnique({
        where: { id: billId },
      });
      if (!existing) throw new Error('Bill not found');
      // `items` present = replace every line (and re-derive the total);
      // absent = leave the lines alone.
      const lines = dto.items ? toLines(dto.items) : null;
      if (lines) await this.assertProductsIn(lines, existing.business_id);
      const updated = await this.prisma.$transaction(async (tx) => {
        if (lines) await this.deleteItems(tx, billId);
        return tx.bills.update({
          where: { id: billId },
          data: {
            bill_number: dto.billNumber ?? undefined,
            total_amount: lines?.length
              ? linesTotal(lines)
              : (dto.totalAmount ?? undefined),
            ...(lines ? { bill_billitems: linesCreate(lines) } : {}),
          },
          include: billInclude,
        });
      });
      return ok('Bill updated successfully', this.mapDTO(updated));
    } catch (e) {
      return fail(`Failed to update bill: ${(e as Error).message}`);
    }
  }

  private apiBase(): string {
    return (
      this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:8080'
    ).replace(/\/+$/, '');
  }

  /**
   * Absolute path of a bill's receipt file. `receipt_url` holds either a
   * relative path ("receipts/<uuid>.pdf") or, for older rows, the full
   * former public URL (".../uploads/receipts/<uuid>.pdf").
   */
  async getReceiptFile(billId: bigint): Promise<string> {
    const bill = await this.prisma.bills.findUnique({
      where: { id: billId },
      select: { receipt_url: true },
    });
    if (!bill?.receipt_url) throw new NotFoundException('No receipt uploaded');
    const stored = bill.receipt_url;
    const marker = '/uploads/';
    const relative = stored.includes(marker)
      ? stored.slice(stored.indexOf(marker) + marker.length)
      : stored;
    return this.storage.resolveStored(relative, 'receipts');
  }

  async uploadReceipt(
    billId: bigint,
    file: Express.Multer.File,
  ): Promise<ResponseObject> {
    try {
      const bill = await this.prisma.bills.findUnique({
        where: { id: billId },
      });
      if (!bill) throw new Error('Bill not found');
      const relativePath = await this.storage.storeFile(
        file,
        'receipts',
        RECEIPT_TYPES,
      );
      const updated = await this.prisma.bills.update({
        where: { id: billId },
        data: { receipt_url: relativePath },
        include: billInclude,
      });
      return ok('Receipt uploaded successfully', this.mapDTO(updated));
    } catch (e) {
      return fail(`Failed to upload receipt: ${(e as Error).message}`);
    }
  }
}
