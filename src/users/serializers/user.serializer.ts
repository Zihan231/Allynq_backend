import { User } from '../entities/user.entity.js';

/** Moderation details only the user and staff may see. */
type PrivateModerationFields =
  | 'suspendReason'
  | 'banReason'
  | 'warningsCount'
  | 'reportStrikes'
  | 'verificationNote'
  | 'verificationReviewedById'
  | 'verificationReviewedAt'
  | 'lastLoginAt'
  | 'bannedAt'
  | 'suspendedUntil'
  | 'deletedAt';

export type PublicUser = Omit<
  User,
  'email' | 'phoneNumber' | 'permanentAddress' | 'documentDataUrl' | 'documentType' | 'password' | 'tokenVersion' | PrivateModerationFields
>;

export function serializeUser(user: User, isSelf = false): PublicUser | User {
  // Always remove sensitive password hash
  const { password: _password, tokenVersion: _tokenVersion, ...safeUser } = user as any;

  if (isSelf) {
    return safeUser as User;
  }

  // Strip private contact and verification information for public responses
  const {
    email: _email,
    phoneNumber: _phoneNumber,
    permanentAddress: _permanentAddress,
    documentDataUrl: _documentDataUrl,
    documentType: _documentType,
    suspendReason: _suspendReason,
    banReason: _banReason,
    warningsCount: _warningsCount,
    reportStrikes: _reportStrikes,
    verificationNote: _verificationNote,
    verificationReviewedById: _verificationReviewedById,
    verificationReviewedAt: _verificationReviewedAt,
    lastLoginAt: _lastLoginAt,
    bannedAt: _bannedAt,
    suspendedUntil: _suspendedUntil,
    deletedAt: _deletedAt,
    ...publicUser
  } = safeUser;

  return publicUser as PublicUser;
}

export function serializeUsers(users: User[], currentUserId?: string | null): (PublicUser | User)[] {
  return users.map((u) => serializeUser(u, Boolean(currentUserId && u.id === currentUserId)));
}
