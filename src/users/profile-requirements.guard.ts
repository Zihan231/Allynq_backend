import { BadRequestException, CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { User } from './entities/user.entity.js';
import { DocumentType } from './enums/user-attributes.enum.js';

export const PROFILE_REQUIREMENT_KEY = 'profileRequirement';
export type ProfileRequirement = 'complete' | 'organizer';

/** Require the public/player profile, plus NID/passport when acting as an organizer. */
export const RequireCompleteProfile = (requirement: ProfileRequirement = 'complete') =>
  SetMetadata(PROFILE_REQUIREMENT_KEY, requirement);

const REQUIRED_PROFILE_FIELDS: Array<[keyof User, string]> = [
  ['dpUrl', 'photo'],
  ['coverUrl', 'coverPhoto'],
  ['inGameId', 'konamiId'],
  ['facebookProfileName', 'facebookName'],
  ['facebookUrl', 'facebookUrl'],
  ['deviceName', 'deviceName'],
  ['deviceModel', 'deviceModel'],
  ['division', 'division'],
  ['district', 'district'],
  ['permanentAddress', 'permanentAddress'],
];

const present = (value: unknown): boolean => typeof value === 'string' ? value.trim().length > 0 : value != null;

export function missingRequiredProfileFields(user: User, requirement: ProfileRequirement): string[] {
  const missing = REQUIRED_PROFILE_FIELDS.filter(([field]) => !present(user[field])).map(([, apiName]) => apiName);
  if (requirement === 'organizer') {
    const acceptedId = user.documentType === DocumentType.NATIONAL_ID || user.documentType === DocumentType.PASSPORT;
    if (!acceptedId || !present(user.documentDataUrl)) missing.push('identityDocument');
  }
  return missing;
}

@Injectable()
export class ProfileRequirementsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requirement = this.reflector.getAllAndOverride<ProfileRequirement>(PROFILE_REQUIREMENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requirement) return true;

    const user = context.switchToHttp().getRequest<Request & { user?: User }>().user;
    const missingFields = user ? missingRequiredProfileFields(user, requirement) : [];
    if (!user || missingFields.length > 0) {
      const baseMessage =
        requirement === 'organizer'
          ? 'Complete your profile and submit an NID or passport before creating a club, community or tournament'
          : 'Complete your profile before joining a club, community or tournament';
      throw new BadRequestException({
        code: 'PROFILE_INCOMPLETE',
        message: missingFields.length ? `${baseMessage}. Missing: ${missingFields.join(', ')}` : baseMessage,
        missingFields,
        profileUrl: '/dashboard/efootball/profile',
      });
    }
    return true;
  }
}
