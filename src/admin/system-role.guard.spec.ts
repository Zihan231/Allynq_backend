import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { SystemRole } from '../users/enums/user-attributes.enum.js';
import { hasSystemRole, SystemRoleGuard } from './system-role.guard.js';

function contextFor(user: unknown) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

function guardRequiring(role: SystemRole | undefined) {
  const reflector = { getAllAndOverride: () => role } as unknown as Reflector;
  return new SystemRoleGuard(reflector);
}

describe('SystemRoleGuard', () => {
  it.each([
    [SystemRole.MODERATOR, null, false],
    [SystemRole.MODERATOR, SystemRole.MODERATOR, true],
    [SystemRole.MODERATOR, SystemRole.SUPER_ADMIN, true],
    [SystemRole.ADMIN, SystemRole.MODERATOR, false],
    [SystemRole.ADMIN, SystemRole.ADMIN, true],
    [SystemRole.SUPER_ADMIN, SystemRole.ADMIN, false],
    [SystemRole.SUPER_ADMIN, SystemRole.SUPER_ADMIN, true],
  ])('requiring %s, a user with role %s passes: %s', (required, role, allowed) => {
    const guard = guardRequiring(required);
    const run = () => guard.canActivate(contextFor({ id: 'u', systemRole: role }));
    if (allowed) expect(run()).toBe(true);
    else expect(run).toThrow(ForbiddenException);
  });

  it('needs at least a moderator when the route names no role', () => {
    expect(() => guardRequiring(undefined).canActivate(contextFor({ id: 'u', systemRole: null }))).toThrow(ForbiddenException);
    expect(guardRequiring(undefined).canActivate(contextFor({ id: 'u', systemRole: SystemRole.MODERATOR }))).toBe(true);
  });

  it('rejects anonymous requests', () => {
    expect(() => guardRequiring(SystemRole.MODERATOR).canActivate(contextFor(undefined))).toThrow(UnauthorizedException);
  });

  it('hasSystemRole ranks moderator < admin < super admin', () => {
    expect(hasSystemRole({ systemRole: SystemRole.ADMIN }, SystemRole.MODERATOR)).toBe(true);
    expect(hasSystemRole({ systemRole: SystemRole.MODERATOR }, SystemRole.ADMIN)).toBe(false);
    expect(hasSystemRole(null, SystemRole.MODERATOR)).toBe(false);
  });
});
