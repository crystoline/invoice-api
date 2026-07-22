import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, roles_name, users } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { toSpringPage } from '../common/dto/page';
import { formatDateAdded } from '../common/util/date.util';
import { generateVerificationToken } from '../common/util/token.util';
import { UpdateUserDto, ChangePasswordEmailDto, ChangePasswordDto, UpdateProfileDto, ChangeOwnPasswordDto } from './dto/auth.dto';

const withRoles = { user_role: { include: { roles: true } } } as const;

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /** The scalar JSON shape a raw Spring `User` entity serializes to (relations are @JsonIgnore). */
  private mapUserEntity(u: users) {
    return {
      id: u.id,
      firstName: u.first_name,
      lastName: u.last_name,
      email: u.email,
      lastLogin: u.last_login,
      status: u.status,
      verified: u.verified,
      username: u.username,
    };
  }

  private mapUserDTO(u: Prisma.usersGetPayload<{ include: typeof withRoles }>) {
    return {
      id: u.id,
      firstName: u.first_name,
      lastName: u.last_name,
      email: u.email,
      userType: u.user_role.map((ur) => ({ id: ur.roles?.id, name: ur.roles?.name })),
      status: u.status,
      verified: u.verified,
      dateAdded: u.date_added,
      lastLogin: u.last_login,
    };
  }

  // #6
  async getAllUsers(): Promise<ResponseObject> {
    const users = await this.prisma.users.findMany({ include: withRoles });
    return ok('Users fetched successfully', users.map((u) => this.mapUserDTO(u)));
  }

  // #7
  async getAllUsersPaginated(page: number, size: number): Promise<ResponseObject> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.users.findMany({ skip: page * size, take: size }),
      this.prisma.users.count(),
    ]);
    return ok('Paged Users fetched successfully', toSpringPage(items.map((u) => this.mapUserEntity(u)), page, size, total));
  }

  // #8
  async getUser(id: bigint): Promise<ResponseObject> {
    const user = await this.prisma.users.findUnique({ where: { id } });
    if (!user) return fail('Failed  to fetch  user: user not found');
    return ok(' User fetched successfully', this.mapUserEntity(user));
  }

  // #9 — legacy throws (→500) when the id is missing; we preserve that.
  async deleteUser(id: bigint): Promise<ResponseObject> {
    const exists = await this.prisma.users.findUnique({ where: { id } });
    if (!exists) throw new Error(`User with id ${id} does not exist`);
    await this.prisma.users.delete({ where: { id } });
    return ok('User deleted successfully.');
  }

  // #10 — requires ROLE_ADMIN (manual check, returns 200-fail like legacy).
  async updateUser(id: bigint, dto: UpdateUserDto, currentUser: AuthUser | null): Promise<ResponseObject> {
    if (!currentUser || !currentUser.roles.includes(roles_name.ROLE_ADMIN)) {
      return fail('Only an Admin User is allowed to perform this action');
    }
    try {
      const target = await this.prisma.users.findUnique({ where: { id } });
      if (!target) return fail('Failed to update user user not found');

      const data: Prisma.usersUpdateInput = {};
      if (dto.firstName != null || dto.lastName != null) {
        data.first_name = dto.firstName;
        data.last_name = dto.lastName;
      }
      await this.prisma.users.update({ where: { id }, data });

      if (dto.userType && dto.userType.length > 0) {
        const roleName = this.mapUserTypeSpaced(dto.userType[0]);
        const role = await this.prisma.roles.findFirst({ where: { name: roleName } });
        if (role) {
          await this.prisma.$transaction([
            this.prisma.user_role.deleteMany({ where: { user_id: id } }),
            this.prisma.user_role.create({ data: { user_id: id, role_id: role.id } }),
          ]);
        }
      }
      const updated = await this.prisma.users.findUnique({ where: { id }, include: withRoles });
      return ok('User updated successfully', updated ? this.mapUserDTO(updated) : null);
    } catch (e) {
      return fail(`Failed to update user ${(e as Error).message}`);
    }
  }

  // update-user uses space-separated role keys (distinct from signup's underscores).
  private mapUserTypeSpaced(key: string): roles_name {
    switch (key) {
      case 'business user':
        return roles_name.BUSINESS_USER;
      case 'admin':
        return roles_name.ROLE_ADMIN;
      case 'super admin':
        return roles_name.ROLE_SUPER_ADMIN;
      default:
        return roles_name.ROLE_USER;
    }
  }

  // #11
  async updateUserStatus(id: bigint, status: boolean): Promise<ResponseObject> {
    const user = await this.prisma.users.findUnique({ where: { id } });
    if (!user) return fail('Failed to toggle user status user not found');
    await this.prisma.users.update({ where: { id }, data: { status } });
    return ok('User status updated successfully', status);
  }

  // #12 — destructive; hardened to SUPER_ADMIN at the controller.
  async deleteAllUsers(): Promise<ResponseObject> {
    await this.prisma.user_role.deleteMany({});
    await this.prisma.users.deleteMany({});
    return ok('Users deleted successfully.');
  }

  // #13
  async getLoggedInUser(currentUser: AuthUser | null): Promise<ResponseObject> {
    if (!currentUser) return ok('User fetched successfully.', null);
    const user = await this.prisma.users.findUnique({ where: { id: currentUser.id } });
    return ok('User fetched successfully.', user ? this.mapUserEntity(user) : null);
  }

  // #14
  async confirmEmailForPasswordReset(dto: ChangePasswordEmailDto): Promise<ResponseObject> {
    const user = await this.prisma.users.findFirst({ where: { email: dto.email } });
    if (!user) return fail('User with email not found.');
    try {
      const token = generateVerificationToken();
      const expiry = new Date(Date.now() + 60 * 60 * 1000);
      await this.prisma.users.update({
        where: { id: user.id },
        data: { verification_token: token, token_expiry_time: expiry },
      });
      const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
      await this.email.sendPasswordEmailConfirmation(
        user.email ?? '',
        user.first_name ?? '',
        `${frontendUrl}/user/confirm-password-reset?token=${token}`,
      );
      return ok('Click the confirmation link sent to your email to reset your password.');
    } catch (e) {
      return fail(`Failed to confirm user email ${(e as Error).message}`);
    }
  }

  // #15 — the fixed reset flow: token → user → set BCrypt(newPassword) → clear token.
  async changePassword(dto: ChangePasswordDto): Promise<ResponseObject> {
    if (!dto.token) return fail('Error trying to  change password  missing token');
    const user = await this.prisma.users.findFirst({ where: { verification_token: dto.token } });
    if (!user) return fail('Error trying to  change password  invalid or expired token');
    if (dto.email && user.email !== dto.email) return fail('Error trying to  change password  email mismatch');
    const valid = user.token_expiry_time ? new Date() < user.token_expiry_time : false;
    if (!valid) return fail('Error trying to  change password  token expired');
    if (dto.newPassword !== dto.confirmNewPassword) return fail('Error trying to  change password  passwords do not match');
    const hashed = await bcrypt.hash(dto.newPassword ?? '', 10);
    await this.prisma.users.update({
      where: { id: user.id },
      data: { password: hashed, verification_token: null },
    });
    return ok('Password changed successfully.');
  }

  // Self-service — update the current user's own profile.
  async updateOwnProfile(id: bigint, dto: UpdateProfileDto): Promise<ResponseObject> {
    try {
      const u = await this.prisma.users.update({
        where: { id },
        data: {
          first_name: dto.firstName ?? undefined,
          last_name: dto.lastName ?? undefined,
        },
      });
      return ok('Profile updated successfully', {
        id: Number(u.id),
        firstName: u.first_name,
        lastName: u.last_name,
        email: u.email,
      });
    } catch (e) {
      return fail(`Failed to update profile ${(e as Error).message}`);
    }
  }

  // Self-service — change the current user's password (knowing the current one).
  async changeOwnPassword(id: bigint, dto: ChangeOwnPasswordDto): Promise<ResponseObject> {
    try {
      const user = await this.prisma.users.findUnique({ where: { id } });
      if (!user) return fail('User not found');
      const match = await bcrypt.compare(dto.currentPassword, user.password ?? '');
      if (!match) return fail('Current password is incorrect');
      await this.prisma.users.update({
        where: { id },
        data: { password: await bcrypt.hash(dto.newPassword, 10) },
      });
      return ok('Password changed successfully');
    } catch (e) {
      return fail(`Failed to change password ${(e as Error).message}`);
    }
  }

  // #16 — stateless; nothing to invalidate server-side.
  logout(): ResponseObject {
    return ok('Logout successful!', null);
  }

  // #17 — seed a known admin (devChux). Hardened to SUPER_ADMIN at the controller.
  async seedDb(): Promise<users | null> {
    const existing = await this.prisma.users.findFirst({ where: { email: 'devChux@gmail.com' } });
    if (existing) return null;
    const role = await this.prisma.roles.findFirst({ where: { name: roles_name.ROLE_ADMIN } });
    const hashed = await bcrypt.hash('password1234', 10);
    return this.prisma.users.create({
      data: {
        username: 'devChux@gmail.com',
        email: 'devChux@gmail.com',
        first_name: 'Chuxman',
        last_name: 'Udechukwu',
        password: hashed,
        status: true,
        verified: false,
        date_added: formatDateAdded(),
        ...(role ? { user_role: { create: [{ roles: { connect: { id: role.id } } }] } } : {}),
      },
    });
  }

  // #18 — destructive; hardened to SUPER_ADMIN at the controller.
  async clearDb(): Promise<string> {
    await this.prisma.user_role.deleteMany({});
    await this.prisma.users.deleteMany({});
    return 'Database cleared successfully.';
  }
}
