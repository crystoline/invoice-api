import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BusinessService } from './business.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { BusinessRequestDto, BusinessSettingsDto, InviteDto } from './dto/business.dto';

/**
 * BusinessController — `/api/businesses`. Route order matters: literal segments
 * (business/users, business/toggle/...) are declared before `business/:businessId`
 * so Express matches them first.
 */
@Controller('businesses')
export class BusinessController {
  constructor(private readonly business: BusinessService) {}

  @Post('business')
  create(@Body() dto: BusinessRequestDto, @CurrentUser() user: AuthUser) {
    return this.business.createBusiness(dto, user);
  }

  @Get()
  getAll(@CurrentUser() user: AuthUser) {
    return this.business.getAllBusinesses(user);
  }

  @Get('paginated-businesses')
  paginated(@Query('page') page = '0', @Query('size') size = '10') {
    return this.business.getAllBusinessesPaginated(Number(page) || 0, Number(size) || 10);
  }

  @Get('owner/businesses')
  ownerBusinesses(@CurrentUser() user: AuthUser) {
    return this.business.getAllBusinessesForOwner(user);
  }

  @Get('business/users')
  businessUsers(@Query('businessId') businessId: string | undefined, @CurrentUser() user: AuthUser) {
    return this.business.getAllBusinessUsers(businessId ? BigInt(businessId) : undefined, user);
  }

  @Get('business/toggle/:businessId')
  toggle(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser) {
    return this.business.toggleBusinessStatus(BigInt(businessId), user);
  }

  @Get('business/:businessId')
  getOne(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser) {
    return this.business.getBusiness(BigInt(businessId), user);
  }

  @Put('business/:businessId')
  update(@Param('businessId') businessId: string, @Body() dto: BusinessRequestDto, @CurrentUser() user: AuthUser) {
    return this.business.updateBusiness(BigInt(businessId), dto, user);
  }

  @Put('business/:businessId/settings')
  updateSettings(@Param('businessId') businessId: string, @Body() dto: BusinessSettingsDto, @CurrentUser() user: AuthUser) {
    return this.business.updateSettings(BigInt(businessId), dto, user);
  }

  @Post('business/:businessId/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadLogo(
    @Param('businessId') businessId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    return this.business.uploadLogo(BigInt(businessId), file, user);
  }

  @Get('switch/:businessId/:userId')
  switch(@Param('businessId') businessId: string, @Param('userId') userId: string) {
    return this.business.switchBusiness(BigInt(businessId), BigInt(userId));
  }

  @Post(':businessId/invite')
  invite(@Param('businessId') businessId: string, @Body() dto: InviteDto, @CurrentUser() user: AuthUser) {
    return this.business.sendInvitation(BigInt(businessId), dto.email ?? '', user);
  }

  @Get('join-business/:businessId/:invitationCode')
  join(
    @Param('businessId') businessId: string,
    @Param('invitationCode') code: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.business.joinBusiness(BigInt(businessId), code, user);
  }

  @Delete('delete/businesses')
  @Roles(Role.SUPER_ADMIN)
  deleteAll() {
    return this.business.deleteAllBusinesses();
  }

  @Delete('delete/businesses/:businessId')
  deleteOne(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser) {
    return this.business.deleteBusiness(BigInt(businessId), user);
  }

  @Get(':businessId/customers')
  customers(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser) {
    return this.business.getAllBusinessCustomers(BigInt(businessId), user);
  }
}
