import { describe, expect, it } from 'vitest';
import { User } from './entities/user.entity.js';
import { DocumentType } from './enums/user-attributes.enum.js';
import { missingRequiredProfileFields } from './profile-requirements.guard.js';

const completeUser = (): User =>
  ({
    dpUrl: '/uploads/photo.jpg',
    coverUrl: '/uploads/cover.jpg',
    inGameId: 'KONAMI-1',
    facebookProfileName: 'Player One',
    facebookUrl: 'https://facebook.com/player.one',
    deviceName: 'Galaxy S25',
    deviceModel: 'SM-S931B',
    division: 'Dhaka',
    district: 'Dhaka',
    permanentAddress: 'Dhaka, Bangladesh',
    documentType: DocumentType.NATIONAL_ID,
    documentDataUrl: 'data:image/jpeg;base64,proof',
  }) as User;

describe('profile requirements', () => {
  it('lists every missing membership field by its API name', () => {
    const missing = missingRequiredProfileFields({} as User, 'complete');
    expect(missing).toEqual([
      'photo',
      'coverPhoto',
      'konamiId',
      'facebookName',
      'facebookUrl',
      'deviceName',
      'deviceModel',
      'division',
      'district',
      'permanentAddress',
    ]);
  });

  it('accepts a complete profile for joining without an identity document', () => {
    const user = completeUser();
    user.documentType = null;
    user.documentDataUrl = null;
    expect(missingRequiredProfileFields(user, 'complete')).toEqual([]);
  });

  it('requires an uploaded NID or passport from organizers', () => {
    const user = completeUser();
    expect(missingRequiredProfileFields(user, 'organizer')).toEqual([]);
    user.documentType = DocumentType.BIRTH_CERTIFICATE;
    expect(missingRequiredProfileFields(user, 'organizer')).toEqual(['identityDocument']);
  });
});
