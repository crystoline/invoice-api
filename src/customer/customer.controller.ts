import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CustomerService } from './customer.service';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { CustomerRequestDto } from './dto/customer.dto';
import { BusinessPermission } from '../common/authz/authz.decorators';
import { Permission } from '../common/authz/permissions';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

/** CustomerController — `/api/customers`. All ops are owner-scoped by businessId. */
@Controller('customers')
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @BusinessPermission(Permission.WRITE, { param: 'businessId' })
  @Post(':businessId/customer')
  create(
    @Param('businessId') businessId: string,
    @Body() dto: CustomerRequestDto,
  ) {
    return this.customers.createCustomer(BigInt(businessId), dto);
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN) // every business's customers
  @Get()
  getAll(@CurrentUser() user: AuthUser) {
    return this.customers.getAllCustomers(user);
  }

  @BusinessPermission(Permission.VIEW, { param: 'businessId' })
  @Get(':businessId/paginated-customers')
  paginated(
    @Param('businessId') businessId: string,
    @Query('page') page = '0',
    @Query('size') size = '10',
  ) {
    return this.customers.getBusinessCustomersPaginated(
      BigInt(businessId),
      Number(page) || 0,
      Number(size) || 10,
    );
  }

  @BusinessPermission(Permission.VIEW, {
    resource: 'customer',
    idParam: 'customerId',
    param: 'businessId',
  })
  @Get(':businessId/:customerId')
  getOne(
    @Param('businessId') businessId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.customers.getBusinessCustomer(
      BigInt(businessId),
      BigInt(customerId),
    );
  }

  @BusinessPermission(Permission.WRITE, {
    resource: 'customer',
    idParam: 'customerId',
    param: 'businessId',
  })
  @Put(':businessId/:customerId')
  update(
    @Param('businessId') businessId: string,
    @Param('customerId') customerId: string,
    @Body() dto: CustomerRequestDto,
  ) {
    return this.customers.updateCustomer(
      BigInt(businessId),
      BigInt(customerId),
      dto,
    );
  }

  @BusinessPermission(Permission.DELETE, {
    resource: 'customer',
    idParam: 'customerId',
    param: 'businessId',
  })
  @Delete(':businessId/:customerId')
  remove(
    @Param('businessId') businessId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.customers.deleteCustomer(
      BigInt(businessId),
      BigInt(customerId),
    );
  }
}
