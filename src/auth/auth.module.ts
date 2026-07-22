import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { UserController } from './user.controller';
import { OAuth2Controller } from './oauth2.controller';
import { AuthService } from './auth.service';
import { UserService } from './user.service';
import { GoogleAuthService } from './google-auth.service';
import { JwtStrategy } from './jwt.strategy';
import { jwtKey } from './jwt.util';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Base64-decoded secret + HS256 + 2h exp — matches legacy JwtUtils.
        secret: jwtKey(config.get<string>('JWT_SECRET') ?? ''),
        signOptions: { algorithm: 'HS256', expiresIn: 7200 },
      }),
    }),
  ],
  controllers: [AuthController, UserController, OAuth2Controller],
  providers: [AuthService, UserService, GoogleAuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
