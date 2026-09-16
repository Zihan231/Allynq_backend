import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JWT_COOKIE_NAME } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

const COOKIE_MAX_AGE_MS = 60 * 60 * 1000; // 1h, matches the JWT expiry

// Deciding secure/sameSite from NODE_ENV is unreliable — Render doesn't set
// it by default, and a wrong guess makes the browser silently drop the
// cookie. `req.secure` reflects the real protocol (via the trust-proxy
// setting in main.ts), so a cross-site HTTPS deployment always gets the
// sameSite=none/secure pairing it needs, and plain-HTTP localhost gets
// sameSite=lax/secure=false, regardless of how NODE_ENV is configured.
function cookieOptions(req: Request) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: (isHttps ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
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
    const result = await this.authService.register(dto);
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
    const result = await this.authService.login(dto);
    res.cookie(JWT_COOKIE_NAME, result.accessToken, {
      ...cookieOptions(req),
      maxAge: COOKIE_MAX_AGE_MS,
    });
    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.clearCookie(JWT_COOKIE_NAME, cookieOptions(req));
    return { success: true };
  }
}
