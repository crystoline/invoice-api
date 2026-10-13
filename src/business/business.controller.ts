import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BusinessService } from './business.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import {
  Authenticated,
  BusinessPermission,
} from '../common/authz/authz.decorators';
import { Permission, isPlatformAdmin } from '../common/authz/permissions';
import {
  BusinessRequestDto,
  BusinessSettingsDto,
  InviteDto,
  MemberRoleDto,
} from './dto/business.dto';

/**
 * BusinessController — `/api/businesses`. Route order matters: literal segments
 * (business/users, business/toggle/...) are declared before `business/:businessId`
 * so Express matches them first.
 */
@Controller('businesses')
export class BusinessController {
  constructor(private readonly business: BusinessService) {}

  @Post('business')
  @Authenticated() // creates a business owned by the caller
  create(@Body() dto: BusinessRequestDto, @CurrentUser() user: AuthUser) {
    return this.business.createBusiness(dto, user);
  }

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  getAll(@CurrentUser() user: AuthUser) {
    return this.business.getAllBusinesses(user);
  }

  @Get('paginated-businesses')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  paginated(@Query('page') page = '0', @Query('size') size = '10') {
    return this.business.getAllBusinessesPaginated(
      Number(page) || 0,
      Number(size) || 10,
    );
  }

  @Get('owner/businesses')
  @Authenticated()
  ownerBusinesses(@CurrentUser() user: AuthUser) {
    return this.business.getAllBusinessesForOwner(user);
  }

  /** Businesses the caller owns or is a member of, each with their role. */
  @Get('mine')
  @Authenticated()
  mine(@CurrentUser() user: AuthUser) {
    return this.business.getMyBusinesses(user);
  }

  @Get('business/users')
  @BusinessPermission(Permission.VIEW, { query: 'businessId' })
  businessUsers(
    @Query('businessId') businessId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.business.getAllBusinessUsers(BigInt(businessId), user);
  }

  @Get('business/toggle/:businessId')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  toggle(
    @Param('businessId') businessId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.business.toggleBusinessStatus(BigInt(businessId), user);
  }

  @Get('business/:businessId')
  @BusinessPermission(Permission.VIEW, { param: 'businessId' })
  getOne(
    @Param('businessId') businessId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.business.getBusiness(BigInt(businessId), user);
  }

  @Put('business/:businessId')
  @BusinessPermission(Permission.MANAGE_SETTINGS, { param: 'businessId' })
  update(
    @Param('businessId') businessId: string,
    @Body() dto: BusinessRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.business.updateBusiness(BigInt(businessId), dto, user);
  }

  @Put('business/:businessId/settings')
  @BusinessPermission(Permission.MANAGE_SETTINGS, { param: 'businessId' })
  updateSettings(
    @Param('businessId') businessId: string,
    @Body() dto: BusinessSettingsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.business.updateSettings(BigInt(businessId), dto, user);
  }

  @Post('business/:businessId/logo')
  @BusinessPermission(Permission.MANAGE_SETTINGS, { param: 'businessId' })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  uploadLogo(
    @Param('businessId') businessId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.business.uploadLogo(BigInt(businessId), file);
  }

  // Sets a user's selected business. Users switch themselves; platform admins
  // may switch anyone (the target must still belong to the business).
  @Get('switch/:businessId/:userId')
  @BusinessPermission(Permission.VIEW, { param: 'businessId' })
  switch(
    @Param('businessId') businessId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    if (String(user.id) !== userId && !isPlatformAdmin(user)) {
      throw new ForbiddenException('You can only switch your own business.');
    }
    return this.business.switchBusiness(BigInt(businessId), BigInt(userId));
  }

  @Post(':businessId/invite')
  @BusinessPermission(Permission.MANAGE_MEMBERS, { param: 'businessId' })
  invite(
    @Param('businessId') businessId: string,
    @Body() dto: InviteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.business.sendInvitation(
      BigInt(businessId),
      dto.email ?? '',
      dto.role,
      user,
    );
  }

  @Get(':businessId/invitations')
  @BusinessPermission(Permission.MANAGE_MEMBERS, { param: 'businessId' })
  invitations(@Param('businessId') businessId: string) {
    return this.business.listInvitations(BigInt(businessId));
  }

  @Delete(':businessId/invitations/:invitationId')
  @BusinessPermission(Permission.MANAGE_MEMBERS, { param: 'businessId' })
  revokeInvitation(
    @Param('businessId') businessId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.business.revokeInvitation(
      BigInt(businessId),
      BigInt(invitationId),
    );
  }

  // Gated by the single-use invitation code itself; joins the caller.
  @Get('join-business/:businessId/:invitationCode')
  @Authenticated()
  join(
    @Param('businessId') businessId: string,
    @Param('invitationCode') code: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.business.joinBusiness(BigInt(businessId), code, user);
  }

  @Put(':businessId/members/:userId/role')
  @BusinessPermission(Permission.MANAGE_MEMBERS, { param: 'businessId' })
  setMemberRole(
    @Param('businessId') businessId: string,
    @Param('userId') userId: string,
    @Body() dto: MemberRoleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.business.setMemberRole(
      BigInt(businessId),
      BigInt(userId),
      dto.role,
      user,
    );
  }

  @Delete(':businessId/members/:userId')
  @BusinessPermission(Permission.MANAGE_MEMBERS, { param: 'businessId' })
  removeMember(
    @Param('businessId') businessId: string,
    @Param('userId') userId: string,
  ) {
    return this.business.removeMember(BigInt(businessId), BigInt(userId));
  }

  @Delete('delete/businesses')
  @Roles(Role.SUPER_ADMIN)
  deleteAll() {
    return this.business.deleteAllBusinesses();
  }

  @Delete('delete/businesses/:businessId')
  @BusinessPermission(Permission.DELETE_BUSINESS, { param: 'businessId' })
  deleteOne(@Param('businessId') businessId: string) {
    return this.business.deleteBusiness(BigInt(businessId));
  }

  @Get(':businessId/customers')
  @BusinessPermission(Permission.VIEW, { param: 'businessId' })
  customers(@Param('businessId') businessId: string) {
    return this.business.getAllBusinessCustomers(BigInt(businessId));
  }
}
