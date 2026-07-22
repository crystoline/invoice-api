import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { AdminService } from './admin.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  AdminCreateUserDto,
  BusinessStatusDto,
  CategoryRequestDto,
  PlanActiveDto,
  PlanRequestDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
} from './dto/admin.dto';

/** Parse a `page`/`size` query param to an int with a fallback. */
const int = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
};
/** Parse an optional boolean query param ('true'/'false'); undefined = no filter. */
const bool = (v: string | undefined): boolean | undefined => {
  if (v === undefined || v === '') return undefined;
  return v === 'true' || v === '1';
};

/**
 * AdminController — `/api/admin`. Platform-admin dashboard endpoints.
 * The class-level @Roles enforces admin-only via the global RolesGuard.
 */
@Controller('admin')
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // --- overview ----------------------------------------------------------
  @Get('stats')
  stats() {
    return this.admin.getStats();
  }

  @Get('activity')
  activity() {
    return this.admin.getActivity();
  }

  // --- users -------------------------------------------------------------
  @Get('users')
  listUsers(
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ) {
    return this.admin.listUsers(search, role, bool(status), int(page, 0), int(size, 20));
  }

  @Post('users')
  createUser(@Body() dto: AdminCreateUserDto) {
    return this.admin.createUser(dto);
  }

  @Patch('users/:id/status')
  setUserStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto) {
    return this.admin.setUserStatus(BigInt(id), dto.active);
  }

  @Post('users/:id/verify')
  verifyUser(@Param('id') id: string) {
    return this.admin.verifyUser(BigInt(id));
  }

  @Put('users/:id/role')
  setUserRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto) {
    return this.admin.setUserRole(BigInt(id), dto);
  }

  @Delete('users/:id')
  deleteUser(@Param('id') id: string) {
    return this.admin.deleteUser(BigInt(id));
  }

  // --- businesses --------------------------------------------------------
  @Get('businesses')
  listBusinesses(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ) {
    return this.admin.listBusinesses(search, bool(status), int(page, 0), int(size, 20));
  }

  @Get('businesses/:id')
  getBusiness(@Param('id') id: string) {
    return this.admin.getBusiness(BigInt(id));
  }

  @Patch('businesses/:id/status')
  setBusinessStatus(@Param('id') id: string, @Body() dto: BusinessStatusDto) {
    return this.admin.setBusinessStatus(BigInt(id), dto.active);
  }

  @Delete('businesses/:id')
  deleteBusiness(@Param('id') id: string) {
    return this.admin.deleteBusiness(BigInt(id));
  }

  // --- subscriptions -----------------------------------------------------
  @Get('subscriptions')
  listSubscriptions(
    @Query('status') status?: string,
    @Query('planId') planId?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ) {
    return this.admin.listSubscriptions(status, planId, int(page, 0), int(size, 20));
  }

  // --- plans -------------------------------------------------------------
  @Get('plans')
  listPlans() {
    return this.admin.listPlans();
  }

  @Post('plans')
  createPlan(@Body() dto: PlanRequestDto) {
    return this.admin.createPlan(dto);
  }

  @Put('plans/:id')
  updatePlan(@Param('id') id: string, @Body() dto: PlanRequestDto) {
    return this.admin.updatePlan(BigInt(id), dto);
  }

  @Patch('plans/:id/active')
  setPlanActive(@Param('id') id: string, @Body() dto: PlanActiveDto) {
    return this.admin.setPlanActive(BigInt(id), dto.active);
  }

  @Delete('plans/:id')
  deletePlan(@Param('id') id: string) {
    return this.admin.deletePlan(BigInt(id));
  }

  // --- categories --------------------------------------------------------
  @Get('categories')
  listCategories() {
    return this.admin.listCategories();
  }

  @Post('categories')
  createCategory(@Body() dto: CategoryRequestDto) {
    return this.admin.createCategory(dto);
  }

  @Put('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: CategoryRequestDto) {
    return this.admin.updateCategory(BigInt(id), dto);
  }

  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.admin.deleteCategory(BigInt(id));
  }
}
