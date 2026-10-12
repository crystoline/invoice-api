import { Injectable } from '@nestjs/common';
import { customers } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { toSpringPage } from '../common/dto/page';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { isPlatformAdmin } from '../common/authz/permissions';
import { CustomerRequestDto } from './dto/customer.dto';

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  // Membership and role are checked by AuthorizationGuard (@BusinessPermission);
  // the service only confirms the business exists and the customer is in it.
  private findBusiness(businessId: bigint) {
    return this.prisma.businesses.findFirst({
      where: { id: businessId },
    });
  }

  private mapDTO(c: customers, businessId: bigint) {
    return {
      id: c.id,
      firstName: c.first_name,
      lastName: c.last_name,
      email: c.email,
      address: c.address,
      parentBusinessId: businessId,
    };
  }

  // raw Customer entity serialization (business @JsonIgnore)
  private mapEntity(c: customers) {
    return {
      id: c.id,
      firstName: c.first_name,
      lastName: c.last_name,
      email: c.email,
      address: c.address,
    };
  }

  // 5.1 — guarded by @BusinessPermission
  async createCustomer(
    businessId: bigint,
    dto: CustomerRequestDto,
  ): Promise<ResponseObject> {
    try {
      const business = await this.findBusiness(businessId);
      if (!business) throw new Error('Business not found');
      const created = await this.prisma.customers.create({
        data: {
          email: dto.email,
          first_name: dto.firstName,
          last_name: dto.lastName,
          address: dto.address,
          business_id: businessId,
        },
      });
      return ok(
        'Customer added successfully',
        this.mapDTO(created, businessId),
      );
    } catch (e) {
      return fail(`Failed to add customer: ${(e as Error).message}`);
    }
  }

  // 5.2 — admin only (fixed admin check)
  async getAllCustomers(user: AuthUser): Promise<ResponseObject> {
    if (!isPlatformAdmin(user)) {
      return fail(
        'Only an Admin is allowed to fetch all customers, please fetch business customers instead',
      );
    }
    const all = await this.prisma.customers.findMany();
    return ok(
      'Customers fetched successfully',
      all.map((c) => this.mapEntity(c)),
    );
  }

  // 5.3 — guarded by @BusinessPermission
  async getBusinessCustomersPaginated(
    businessId: bigint,
    page: number,
    size: number,
  ): Promise<ResponseObject> {
    const business = await this.findBusiness(businessId);
    if (!business) throw new Error('Business not found');
    try {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.customers.findMany({
          where: { business_id: businessId },
          skip: page * size,
          take: size,
        }),
        this.prisma.customers.count({ where: { business_id: businessId } }),
      ]);
      return ok(
        'Paged Business Customers fetched successfully',
        toSpringPage(
          items.map((c) => this.mapEntity(c)),
          page,
          size,
          total,
        ),
      );
    } catch (e) {
      return fail(
        `Failed  to fetch paged business customers: ${(e as Error).message}`,
      );
    }
  }

  // 5.4 — guarded by @BusinessPermission
  async getBusinessCustomer(
    businessId: bigint,
    customerId: bigint,
  ): Promise<ResponseObject> {
    try {
      const business = await this.findBusiness(businessId);
      if (!business) throw new Error('Business not found');
      const customer = await this.prisma.customers.findFirst({
        where: { id: customerId, business_id: businessId },
      });
      if (!customer) throw new Error('Customer not found');
      return ok(
        'Customer fetched successfully',
        this.mapDTO(customer, businessId),
      );
    } catch (e) {
      return fail(`Failed  to fetch Customer: ${(e as Error).message}`);
    }
  }

  // 5.5 — guarded by @BusinessPermission
  async updateCustomer(
    businessId: bigint,
    customerId: bigint,
    dto: CustomerRequestDto,
  ): Promise<ResponseObject> {
    try {
      const business = await this.findBusiness(businessId);
      if (!business) throw new Error('Business not found');
      const customer = await this.prisma.customers.findFirst({
        where: { id: customerId, business_id: businessId },
      });
      if (!customer)
        throw new Error(
          'Customer not found or does not belong to the business',
        );
      const updated = await this.prisma.customers.update({
        where: { id: customerId },
        data: {
          email: dto.email,
          first_name: dto.firstName,
          last_name: dto.lastName,
          address: dto.address,
        },
      });
      return ok(
        'Customers updated successfully',
        this.mapDTO(updated, businessId),
      );
    } catch (e) {
      return fail(`Failed  to update customer: ${(e as Error).message}`);
    }
  }

  // 5.6 — guarded by @BusinessPermission
  async deleteCustomer(
    businessId: bigint,
    customerId: bigint,
  ): Promise<ResponseObject> {
    try {
      const business = await this.findBusiness(businessId);
      if (!business) throw new Error('Business not found');
      const customer = await this.prisma.customers.findFirst({
        where: { id: customerId, business_id: businessId },
      });
      if (!customer)
        throw new Error(
          'Customer not found or does not belong to the business',
        );
      await this.prisma.customers.delete({ where: { id: customerId } });
      return ok('Customer deleted successfully');
    } catch (e) {
      return fail(`Failed  to delete customer: ${(e as Error).message}`);
    }
  }
}
