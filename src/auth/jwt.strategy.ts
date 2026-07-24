import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { isInactive, jwtKey } from './jwt.util';

interface JwtPayload {
  sub?: string;
  email?: string;
  last_activity?: string;
  token_type?: string;
  /** Set to '2fa' on the short-lived login challenge — never a session token. */
  purpose?: string;
}

/**
 * Reproduces Spring's AuthTokenFilter: validates the Bearer JWT (HS256, the
 * Base64-decoded secret, standard exp), enforces the 30-min `last_activity`
 * inactivity window, then re-loads the user from the DB by username (== email)
 * and rejects deactivated accounts — exactly as loadUserByUsername did.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtKey(config.get<string>('JWT_SECRET') ?? ''),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    // A 2FA challenge proves only that the password step passed. It must never
    // authenticate a request, even though its `sub` would fail the lookup below.
    if (payload.purpose === '2fa') {
      throw new UnauthorizedException('Invalid token');
    }
    if (isInactive(payload.last_activity)) {
      throw new UnauthorizedException('Session expired due to inactivity');
    }
    const email = payload.sub ?? payload.email;
    if (!email) {
      throw new UnauthorizedException('Invalid token');
    }
    const user = await this.prisma.users.findFirst({
      where: { username: email },
      include: { user_role: { include: { roles: true } } },
    });
    if (!user) {
      throw new UnauthorizedException(`User Not Found with username: ${email}`);
    }
    if (!user.status) {
      throw new UnauthorizedException('User is deactivated. Please contact the administrator.');
    }
    const roles = user.user_role
      .map((ur) => ur.roles?.name)
      .filter((n): n is NonNullable<typeof n> => Boolean(n)) as unknown as string[];
    return { id: user.id, email: user.email ?? '', roles };
  }
}
