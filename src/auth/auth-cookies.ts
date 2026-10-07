import type { Request } from 'express';

/** While staff view the app as a user, their own session waits in this cookie. */
export const STAFF_COOKIE_NAME = 'allync_staff_token';

// Deciding secure/sameSite from NODE_ENV is unreliable — Render doesn't set
// it by default, and a wrong guess makes the browser silently drop the
// cookie. `req.secure` reflects the real protocol (via the trust-proxy
// setting in main.ts), so a cross-site HTTPS deployment always gets the
// sameSite=none/secure pairing it needs, and plain-HTTP localhost gets
// sameSite=lax/secure=false, regardless of how NODE_ENV is configured.
export function cookieOptions(req: Request) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: (isHttps ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
  };
}
