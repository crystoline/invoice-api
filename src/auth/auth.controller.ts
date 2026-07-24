import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { fail } from '../common/dto/response-object';
import { SignupDto, LoginDto, ChangePasswordEmailDto } from './dto/auth.dto';

/**
 * AuthController — `/api/auth`. Public auth flows plus create-admin.
 * (UserController shares the `/api/auth` prefix; see user.controller.ts.)
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // #1
  @Public()
  @Post('sign-up')
  signUp(@Body() dto: SignupDto) {
    return this.auth.createUser(dto, null);
  }

  // #2 — manual ROLE_SUPER_ADMIN check (returns 200-fail like legacy, not 403).
  @Post('create-admin-user')
  createAdmin(@Body() dto: SignupDto, @CurrentUser() user: AuthUser) {
    if (!user.roles.includes(Role.SUPER_ADMIN)) {
      return fail('You do not have the permission to create this user');
    }
    return this.auth.createUser(dto, user);
  }

  // #3 — login; also mirrors the legacy Authorization response header.
  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto);
    // Absent when 2FA is on — that response carries a challenge, not a session.
    const authHeader = (result.headers as { Authorization?: string[] } | undefined)?.Authorization?.[0];
    if (authHeader) res.setHeader('Authorization', authHeader);
    return result;
  }

  // #4
  @Public()
  @Post('user/verify/:token')
  verify(@Param('token') token: string, @Body() dto: ChangePasswordEmailDto) {
    return this.auth.verifyUser(token, dto.email ?? '');
  }

  // #5
  @Public()
  @Post('resend-verification-email')
  resend(@Body() dto: ChangePasswordEmailDto) {
    return this.auth.sendUserVerificationEmail(dto);
  }
}
