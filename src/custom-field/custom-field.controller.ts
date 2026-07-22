import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { CustomFieldService } from './custom-field.service';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { InvoiceConfigRequestDto } from './dto/custom-field.dto';

/**
 * InvoiceCustomFieldConfigController — `/api/config/custom-fields`.
 * Clean routes (the legacy `@PostMapping(" ")`/`@GetMapping(" ")` resolved to
 * `/%20`; not reproduced). Scoped to the authenticated owner.
 */
@Controller('config/custom-fields')
export class CustomFieldController {
  constructor(private readonly service: CustomFieldService) {}

  @Post()
  create(@Body() dto: InvoiceConfigRequestDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  getAll(@CurrentUser() user: AuthUser) {
    return this.service.getAllForOwner(user.id);
  }

  @Get(':configId')
  getOne(@Param('configId') configId: string, @CurrentUser() user: AuthUser) {
    return this.service.getById(BigInt(configId), user.id);
  }

  @Put(':configId')
  update(@Param('configId') configId: string, @Body() dto: InvoiceConfigRequestDto, @CurrentUser() user: AuthUser) {
    return this.service.update(BigInt(configId), dto, user.id);
  }

  @Delete(':configId')
  remove(@Param('configId') configId: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(BigInt(configId), user.id);
  }
}
