import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { CustomerRequestDto } from './dto/customer.dto';

/** CustomerController — `/api/customers`. All ops are owner-scoped by businessId. */
@Controller('customers')
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Post(':businessId/customer')
  create(@Param('businessId') businessId: string, @Body() dto: CustomerRequestDto, @CurrentUser() user: AuthUser) {
    return this.customers.createCustomer(BigInt(businessId), dto, user);
  }

  @Get()
  getAll(@CurrentUser() user: AuthUser) {
    return this.customers.getAllCustomers(user);
  }

  @Get(':businessId/paginated-customers')
  paginated(
    @Param('businessId') businessId: string,
    @Query('page') page = '0',
    @Query('size') size = '10',
    @CurrentUser() user: AuthUser,
  ) {
    return this.customers.getBusinessCustomersPaginated(BigInt(businessId), Number(page) || 0, Number(size) || 10, user);
  }

  @Get(':businessId/:customerId')
  getOne(@Param('businessId') businessId: string, @Param('customerId') customerId: string, @CurrentUser() user: AuthUser) {
    return this.customers.getBusinessCustomer(BigInt(businessId), BigInt(customerId), user);
  }

  @Put(':businessId/:customerId')
  update(
    @Param('businessId') businessId: string,
    @Param('customerId') customerId: string,
    @Body() dto: CustomerRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.customers.updateCustomer(BigInt(businessId), BigInt(customerId), dto, user);
  }

  @Delete(':businessId/:customerId')
  remove(@Param('businessId') businessId: string, @Param('customerId') customerId: string, @CurrentUser() user: AuthUser) {
    return this.customers.deleteCustomer(BigInt(businessId), BigInt(customerId), user);
  }
}
