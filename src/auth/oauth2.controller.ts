import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { GoogleAuthService } from './google-auth.service';
import { Public } from '../common/decorators/public.decorator';

/**
 * OAuth2Controller — `/api/oauth2`. Kicks off Google login and handles the
 * callback, minting the app JWT and redirecting to the frontend with it.
 * The post-login redirect base is env-driven (OAUTH_SUCCESS_REDIRECT), unlike
 * the legacy hardcoded http://localhost:3001.
 */
@Controller('oauth2')
export class OAuth2Controller {
  constructor(
    private readonly google: GoogleAuthService,
    private readonly config: ConfigService,
  ) {}

  // #19
  @Public()
  @Get('google')
  startGoogle(@Res() res: Response) {
    return res.redirect(this.google.authorizationUrl());
  }

  // #20
  @Public()
  @Get('login/oauth2/code/google')
  async googleCallback(@Query('code') code: string, @Res() res: Response) {
    // Falls back to FRONTEND_URL (the app's own origin) rather than a
    // hardcoded port, so this works without extra config in most setups.
    const base =
      this.config.get<string>('OAUTH_SUCCESS_REDIRECT') ??
      this.config.get<string>('FRONTEND_URL') ??
      'http://localhost:3000';
    const result = await this.google.handleCallback(code);
    if (result) {
      // /oauth/callback is a dedicated frontend route that stores the token and
      // routes onward — it cannot be a protected page, since we are not logged
      // in until it runs.
      const params = new URLSearchParams({
        jwtToken: result.token,
        userId: String(result.userId),
      });
      return res.redirect(`${base}/oauth/callback?${params.toString()}`);
    }
    return res.redirect(`${base}/login?oauth=failed`);
  }
}
