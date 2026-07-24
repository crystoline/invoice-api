import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TwoFactorService } from './two-factor.service';
import { AuthService } from './auth.service';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { TwoFactorCodeDto, TwoFactorLoginDto } from './dto/two-factor.dto';

/**
 * TwoFactorController — `/api/auth/2fa`.
 *
 * Everything except `login` requires an existing session: you enrol from inside
 * settings. `login` is public because it is the second leg of signing in.
 */
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly auth: AuthService,
  ) {}

  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.twoFactor.status(user);
  }

  /** Step 1 — returns the QR code / secret to add to an authenticator app. */
  @Post('setup')
  setup(@CurrentUser() user: AuthUser) {
    return this.twoFactor.beginSetup(user);
  }

  /** Step 2 — first valid code switches 2FA on and returns the recovery codes. */
  @Post('confirm')
  confirm(@Body() dto: TwoFactorCodeDto, @CurrentUser() user: AuthUser) {
    return this.twoFactor.confirmSetup(user, dto.code);
  }

  @Post('disable')
  disable(@Body() dto: TwoFactorCodeDto, @CurrentUser() user: AuthUser) {
    return this.twoFactor.disable(user, dto.code);
  }

  @Post('recovery-codes')
  regenerate(@Body() dto: TwoFactorCodeDto, @CurrentUser() user: AuthUser) {
    return this.twoFactor.regenerateRecoveryCodes(user, dto.code);
  }

  /** Second leg of login — exchanges the challenge token + code for a session. */
  @Public()
  @Post('login')
  async login(@Body() dto: TwoFactorLoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.completeTwoFactorLogin(dto);
    const authHeader = (result.headers as { Authorization?: string[] } | undefined)?.Authorization?.[0];
    if (authHeader) res.setHeader('Authorization', authHeader);
    return result;
  }
}
