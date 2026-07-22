import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, roles_name } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { formatDateAdded } from '../common/util/date.util';
import { generateVerificationToken } from '../common/util/token.util';
import { formatLastActivity } from './jwt.util';
import { SignupDto, LoginDto, ChangePasswordEmailDto } from './dto/auth.dto';

const userWithRoles = Prisma.validator<Prisma.usersDefaultArgs>()({
  include: { user_role: { include: { roles: true } } },
});
type UserWithRoles = Prisma.usersGetPayload<typeof userWithRoles>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  private async roleIdByName(name: roles_name): Promise<number> {
    const role = await this.prisma.roles.findFirst({ where: { name } });
    if (!role) throw new Error('Error: Role is not found.');
    return role.id;
  }

  private mapToUserDTO(user: UserWithRoles) {
    return {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      userType: user.user_role.map((ur) => ({ id: ur.roles?.id, name: ur.roles?.name })),
      status: user.status,
      verified: user.verified,
      dateAdded: user.date_added,
      lastLogin: user.last_login,
    };
  }

  /** Persist token + 1h expiry and email the verification/reset link. */
  private async sendVerificationEmailToUser(userId: bigint, email: string, firstName: string): Promise<string> {
    const token = generateVerificationToken();
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await this.prisma.users.update({
      where: { id: userId },
      data: { verification_token: token, token_expiry_time: expiry },
    });
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    await this.email.sendVerificationEmail(email, firstName, `${frontendUrl}/user/verify?token=${token}`);
    return token;
  }

  /**
   * Backs sign-up (#1) and create-admin-user (#2). Role assignment mirrors the
   * legacy: anonymous → ROLE_USER; a super-admin caller → ROLE_ADMIN; an
   * authenticated non-super-admin caller → no role (legacy edge case).
   */
  async createUser(dto: SignupDto, currentUser: AuthUser | null): Promise<ResponseObject> {
    if (dto.email) {
      const existing = await this.prisma.users.findFirst({ where: { email: dto.email } });
      if (existing) return fail('Email already exists.');
    }

    let roleName: roles_name | null;
    if (currentUser) {
      roleName = currentUser.roles.includes(roles_name.ROLE_SUPER_ADMIN) ? roles_name.ROLE_ADMIN : null;
    } else {
      roleName = roles_name.ROLE_USER;
    }

    const hashed = await bcrypt.hash(dto.password ?? '', 10);
    const created = await this.prisma.users.create({
      data: {
        username: dto.email,
        email: dto.email,
        first_name: dto.firstName,
        last_name: dto.lastName,
        password: hashed,
        status: true,
        verified: false,
        date_added: formatDateAdded(),
        ...(roleName
          ? { user_role: { create: [{ roles: { connect: { id: await this.roleIdByName(roleName) } } }] } }
          : {}),
      },
      include: { user_role: { include: { roles: true } } },
    });

    await this.sendVerificationEmailToUser(created.id, dto.email ?? '', dto.firstName ?? '');

    const message = currentUser ? 'Admin User created successfully.' : 'User sign up, successful.';
    return ok(message, this.mapToUserDTO(created));
  }

  /**
   * Login (#3). Bad credentials / disabled → 401 (AuthenticationException
   * parity). Returns the legacy double-wrapped nested envelope so the frontend
   * can read the JWT from body.data.token (and the Authorization header).
   */
  async login(dto: LoginDto): Promise<Record<string, unknown>> {
    const user = await this.prisma.users.findFirst({
      where: { username: dto.username },
      include: { user_role: { include: { roles: true } } },
    });
    if (!user || !user.password) throw new UnauthorizedException('Bad credentials');
    if (!user.status) throw new UnauthorizedException('User is deactivated. Please contact the administrator.');
    const matches = await bcrypt.compare(dto.password ?? '', user.password);
    if (!matches) throw new UnauthorizedException('Bad credentials');

    const token = this.signToken(user.username ?? user.email ?? '');
    await this.prisma.users.update({ where: { id: user.id }, data: { last_login: new Date() } });

    // The frontend routes off businessesOwned at login (single business → its
    // dashboard; none → choose/create). Must return the user's real businesses.
    const owned = await this.prisma.businesses.findMany({ where: { owner_id: user.id } });

    const roles = user.user_role.map((ur) => ur.roles?.name).filter(Boolean);
    let accountVerificationMessage = 'Verified Account';
    if (!user.verified) {
      accountVerificationMessage = 'Account not verified, click  the link sent to your email to verify';
      await this.sendVerificationEmailToUser(user.id, user.email ?? '', user.first_name ?? '');
    }

    const body = {
      responseCode: '00',
      success: true,
      message: 'User authenticated successfully',
      accountVerificationMessage,
      data: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        lastLogin: user.last_login,
        status: user.status,
        token,
        roles,
        verified: user.verified,
        businessesOwned: owned.map((b) => ({
          id: b.id,
          businessName: b.business_name,
          businessAddress: b.business_address,
          businessEmail: b.business_email,
          isActive: b.is_active,
          businessRole: b.business_role,
        })),
      },
    };
    return { headers: { Authorization: [`Bearer ${token}`] }, body, statusCode: 'OK', statusCodeValue: 200 };
  }

  /** Sign a JWT with the exact legacy claim set (2h exp via JwtModule config). */
  signToken(email: string): string {
    return this.jwt.sign({
      sub: email,
      token_type: 'access_token',
      email,
      last_activity: formatLastActivity(new Date()),
    });
  }

  /** Resend verification email (#5). Unknown email → 200 fail (legacy 500 hardened). */
  async sendUserVerificationEmail(dto: ChangePasswordEmailDto): Promise<ResponseObject> {
    const user = await this.prisma.users.findFirst({ where: { email: dto.email } });
    if (!user) return fail('User with email not found.');
    if (user.verified) return fail('User account is already verified ');
    try {
      await this.sendVerificationEmailToUser(user.id, user.email ?? '', user.first_name ?? '');
      return ok('Verification email sent successfully.');
    } catch (e) {
      return fail(`Error trying to send verification email ${(e as Error).message}`);
    }
  }

  /** Verify account (#4). */
  async verifyUser(token: string, email: string): Promise<ResponseObject> {
    const user = await this.prisma.users.findFirst({ where: { verification_token: token } });
    if (!user || user.email !== email) return fail('User verification failed, contact support center');
    if (user.verified) return ok('Account is already verified. Login to proceed');
    const valid = user.token_expiry_time ? new Date() < user.token_expiry_time : false;
    if (!valid) return fail('User verification failed, contact support center');
    await this.prisma.users.update({
      where: { id: user.id },
      data: { status: true, verified: true, verification_token: null },
    });
    return ok('User verified successfully! Login to proceed');
  }
}
