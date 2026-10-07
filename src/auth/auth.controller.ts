import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JWT_COOKIE_NAME } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import {
  StaffTwoFactorTokenDto,
  VerifyStaffTwoFactorDto,
} from './dto/two-factor.dto.js';
import { cookieOptions, STAFF_COOKIE_NAME } from './auth-cookies.js';

const COOKIE_MAX_AGE_MS = 60 * 60 * 1000; // 1h, matches the JWT expiry

function clientInfo(req: Request) {
  const deviceHeader = req.headers['x-device-id'];
  const deviceId = Array.isArray(deviceHeader) ? deviceHeader[0] : deviceHeader;
  return {
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent']?.slice(0, 500) ?? null,
    deviceId: deviceId?.slice(0, 255) ?? null,
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(dto, clientInfo(req));
    res.clearCookie(STAFF_COOKIE_NAME, cookieOptions(req));
    res.cookie(JWT_COOKIE_NAME, result.accessToken, {
      ...cookieOptions(req),
      maxAge: COOKIE_MAX_AGE_MS,
    });
    return result;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, clientInfo(req));
    if ('accessToken' in result) {
      res.clearCookie(STAFF_COOKIE_NAME, cookieOptions(req));
      res.cookie(JWT_COOKIE_NAME, result.accessToken, {
        ...cookieOptions(req),
        maxAge: COOKIE_MAX_AGE_MS,
      });
    }
    return result;
  }

  /** Returns an authenticator-app secret for a staff member's first secure sign-in. */
  @Post('staff-2fa/setup')
  @HttpCode(HttpStatus.OK)
  staffTwoFactorSetup(@Body() dto: StaffTwoFactorTokenDto) {
    return this.authService.staffTwoFactorSetup(dto.token);
  }

  /** Completes staff sign-in after a valid authenticator code. */
  @Post('staff-2fa/verify')
  @HttpCode(HttpStatus.OK)
  async staffTwoFactorVerify(
    @Body() dto: VerifyStaffTwoFactorDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.completeStaffTwoFactor(
      dto.token,
      dto.code,
      clientInfo(req),
    );
    res.clearCookie(STAFF_COOKIE_NAME, cookieOptions(req));
    res.cookie(JWT_COOKIE_NAME, result.accessToken, {
      ...cookieOptions(req),
      maxAge: COOKIE_MAX_AGE_MS,
    });
    return result;
  }

  /**
   * Leaves a view-as-user session: the staff member's own session comes back. Works even
   * after the short view-as token has expired.
   */
  @Post('view-as/exit')
  @HttpCode(HttpStatus.OK)
  exitViewAs(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const staffToken: string | undefined = req.cookies?.[STAFF_COOKIE_NAME];
    res.clearCookie(STAFF_COOKIE_NAME, cookieOptions(req));
    if (!staffToken) {
      res.clearCookie(JWT_COOKIE_NAME, cookieOptions(req));
      return { restored: false };
    }
    res.cookie(JWT_COOKIE_NAME, staffToken, {
      ...cookieOptions(req),
      maxAge: COOKIE_MAX_AGE_MS,
    });
    return { restored: true };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.clearCookie(JWT_COOKIE_NAME, cookieOptions(req));
    res.clearCookie(STAFF_COOKIE_NAME, cookieOptions(req));
    return { success: true };
  }
}
