import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { UserService } from './user.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { UpdateUserDto, ChangePasswordEmailDto, ChangePasswordDto, UpdateProfileDto, ChangeOwnPasswordDto } from './dto/auth.dto';

/**
 * UserController — shares the `/api/auth` prefix with AuthController (as in
 * Spring). User CRUD + the password-reset request/confirm flow.
 *
 * NOTE: the three destructive endpoints (delete/users, seed/db, clear-db/all)
 * are open to any authenticated user in the legacy app. They are NOT part of
 * the frontend contract, so the port hardens them to ROLE_SUPER_ADMIN.
 */
@Controller('auth')
export class UserController {
  constructor(private readonly users: UserService) {}

  // #6
  @Get('users')
  getUsers() {
    return this.users.getAllUsers();
  }

  // #7
  @Get('paginated-users')
  paginated(@Query('page') page = '0', @Query('size') size = '10') {
    return this.users.getAllUsersPaginated(Number(page) || 0, Number(size) || 10);
  }

  // #8
  @Get('users/:userId')
  getUser(@Param('userId') userId: string) {
    return this.users.getUser(BigInt(userId));
  }

  // #9
  @Delete('delete-user/:userId')
  deleteUser(@Param('userId') userId: string) {
    return this.users.deleteUser(BigInt(userId));
  }

  // #10
  @Put('update-user/:userId')
  updateUser(@Param('userId') userId: string, @Body() dto: UpdateUserDto, @CurrentUser() user: AuthUser) {
    return this.users.updateUser(BigInt(userId), dto, user);
  }

  // #11 — raw JSON boolean body.
  @Put('users/toggle/:userId')
  toggle(@Param('userId') userId: string, @Body() status: boolean) {
    return this.users.updateUserStatus(BigInt(userId), status);
  }

  // #12
  @Delete('delete/users')
  @Roles(Role.SUPER_ADMIN)
  deleteAll() {
    return this.users.deleteAllUsers();
  }

  // #13
  @Get('loggedIn-user')
  loggedInUser(@CurrentUser() user: AuthUser) {
    return this.users.getLoggedInUser(user);
  }

  // #14 — public
  @Public()
  @Post('request-change-password')
  requestChangePassword(@Body() dto: ChangePasswordEmailDto) {
    return this.users.confirmEmailForPasswordReset(dto);
  }

  // #15 — public; token accepted from body or query (legacy path bug fixed).
  @Public()
  @Post('confirm-password-reset')
  confirmPasswordReset(@Body() dto: ChangePasswordDto, @Query('token') token?: string) {
    if (!dto.token && token) dto.token = token;
    return this.users.changePassword(dto);
  }

  // Self-service — update the current user's own profile.
  @Put('profile')
  updateProfile(@Body() dto: UpdateProfileDto, @CurrentUser() user: AuthUser) {
    return this.users.updateOwnProfile(BigInt(user.id), dto);
  }

  // Self-service — change the current user's password (knowing the current one).
  @Post('change-password')
  changeOwnPassword(@Body() dto: ChangeOwnPasswordDto, @CurrentUser() user: AuthUser) {
    return this.users.changeOwnPassword(BigInt(user.id), dto);
  }

  // #16
  @Post('logout')
  logout() {
    return this.users.logout();
  }

  // #17 — hardened to SUPER_ADMIN
  @Post('seed/db')
  @Roles(Role.SUPER_ADMIN)
  seed() {
    return this.users.seedDb();
  }

  // #18 — hardened to SUPER_ADMIN
  @Post('clear-db/all')
  @Roles(Role.SUPER_ADMIN)
  clear() {
    return this.users.clearDb();
  }
}
