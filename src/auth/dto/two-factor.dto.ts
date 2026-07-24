import { IsNotEmpty, IsString } from 'class-validator';

/** A 6-digit TOTP code, or a `XXXX-XXXX` recovery code. */
export class TwoFactorCodeDto {
  @IsString()
  @IsNotEmpty({ message: 'Enter the code from your authenticator app.' })
  code: string;
}

/** Second step of login: exchange the challenge token + code for a session. */
export class TwoFactorLoginDto {
  @IsString()
  @IsNotEmpty({ message: 'Missing challenge token — start the sign-in again.' })
  challengeToken: string;

  @IsString()
  @IsNotEmpty({ message: 'Enter the code from your authenticator app.' })
  code: string;
}
