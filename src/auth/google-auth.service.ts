import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { roles_name } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuthService } from './auth.service';
import { formatDateAdded } from '../common/util/date.util';
import { generateVerificationToken } from '../common/util/token.util';

/**
 * Google OAuth2 login — a faithful port of GoogleAuthenticationProvider, but
 * with all client credentials read from env (never hardcoded). Exchanges the
 * authorization code for an id_token, upserts the user (ROLE_USER), and mints
 * the app's own JWT. Returns null on any failure (→ redirect to login).
 *
 * Not runtime-verified (no OAuth credentials available); compiles and follows
 * the documented flow.
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly auth: AuthService,
  ) {}

  private redirectUri(): string {
    const base = this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:8080';
    return `${base}/api/oauth2/login/oauth2/code/google`;
  }

  authorizationUrl(): string {
    const params = new URLSearchParams({
      client_id: this.config.get<string>('GOOGLE_CLIENT_ID') ?? '',
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async handleCallback(code: string): Promise<{ token: string; userId: bigint } | null> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret || !code) return null;
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: this.redirectUri(),
          grant_type: 'authorization_code',
          access_type: 'offline',
        }),
      });
      const json = (await res.json()) as { id_token?: string };
      if (!json.id_token) return null;
      const claims = JSON.parse(
        Buffer.from(json.id_token.split('.')[1], 'base64url').toString('utf8'),
      ) as { email?: string; given_name?: string; family_name?: string };
      if (!claims.email) return null;

      let user = await this.prisma.users.findFirst({ where: { email: claims.email } });
      if (!user) {
        const role = await this.prisma.roles.findFirst({ where: { name: roles_name.ROLE_USER } });
        user = await this.prisma.users.create({
          data: {
            username: claims.email,
            email: claims.email,
            first_name: claims.given_name,
            last_name: claims.family_name,
            password: await bcrypt.hash('password', 10),
            status: true,
            verified: false,
            date_added: formatDateAdded(),
            ...(role ? { user_role: { create: [{ roles: { connect: { id: role.id } } }] } } : {}),
          },
        });
        const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
        const vToken = generateVerificationToken();
        await this.prisma.users.update({
          where: { id: user.id },
          data: { verification_token: vToken, token_expiry_time: new Date(Date.now() + 3600_000) },
        });
        await this.email.sendVerificationEmail(
          claims.email,
          claims.given_name ?? '',
          `${frontendUrl}/user/verify?token=${vToken}`,
        );
      }
      await this.prisma.users.update({ where: { id: user.id }, data: { last_login: new Date() } });
      return { token: this.auth.signToken(claims.email), userId: user.id };
    } catch (e) {
      this.logger.error(`Google OAuth callback failed: ${(e as Error).message}`);
      return null;
    }
  }
}
