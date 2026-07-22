import { IsArray, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Auth DTOs. The Spring DTOs carry NO bean-validation and controllers don't use
 * @Valid — all checks are manual in services. We add only lenient @IsOptional
 * type guards so the global ValidationPipe (whitelist) doesn't strip fields;
 * we deliberately do NOT tighten validation (e.g. no @IsEmail) to preserve
 * byte-for-byte request compatibility.
 */

export class SignupDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() password?: string;
}

export class LoginDto {
  @IsOptional() @IsString() username?: string; // the user's email
  @IsOptional() @IsString() password?: string;
}

export class ChangePasswordEmailDto {
  @IsOptional() @IsString() email?: string;
}

export class ChangePasswordDto {
  // The Spring route was broken (@PathVariable without {token}); the port takes
  // the reset token from the request (query or body). See migration doc.
  @IsOptional() @IsString() token?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() newPassword?: string;
  @IsOptional() @IsString() confirmNewPassword?: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsArray() userType?: string[];
}

export class UpdateProfileDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
}

export class ChangeOwnPasswordDto {
  @IsString() @IsNotEmpty() currentPassword: string;
  @IsString() @MinLength(8) newPassword: string;
}
