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
  | 'email'
  | 'phoneNumber'
  | 'permanentAddress'
  | 'documentDataUrl'
  | 'documentType'
  | 'password'
  | 'tokenVersion'
  | 'twoFactorSecretEncrypted'
  | 'twoFactorEnabledAt'
  | 'twoFactorLastCounter'
  | 'twoFactorFailedAttempts'
  | 'twoFactorLockedUntil'
  | 'authContext'
  | PrivateModerationFields
>;

export function serializeUser(user: User, isSelf = false): PublicUser | User {
  // Always remove sensitive password hash
  const {
    password: _password,
    tokenVersion: _tokenVersion,
    twoFactorSecretEncrypted: _twoFactorSecretEncrypted,
    twoFactorLastCounter: _twoFactorLastCounter,
    twoFactorFailedAttempts: _twoFactorFailedAttempts,
    twoFactorLockedUntil: _twoFactorLockedUntil,
    authContext: _authContext,
    ...safeUser
  } = user as any;

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
    twoFactorEnabledAt: _twoFactorEnabledAt,
    ...publicUser
  } = safeUser;

  return publicUser as PublicUser;
}

export function serializeUsers(
  users: User[],
  currentUserId?: string | null,
): (PublicUser | User)[] {
  return users.map((u) =>
    serializeUser(u, Boolean(currentUserId && u.id === currentUserId)),
  );
}

/** Fields of a user that only the user (or staff) may see. */
const PRIVATE_USER_FIELDS = [
  'email',
  'phoneNumber',
  'permanentAddress',
  'documentDataUrl',
  'documentType',
  'password',
  'tokenVersion',
  'twoFactorSecretEncrypted',
  'twoFactorEnabledAt',
  'twoFactorLastCounter',
  'twoFactorFailedAttempts',
  'twoFactorLockedUntil',
  'authContext',
  'suspendReason',
  'banReason',
  'warningsCount',
  'reportStrikes',
  'verificationNote',
  'verificationReviewedById',
  'verificationReviewedAt',
  'lastLoginAt',
  'bannedAt',
  'suspendedUntil',
] as const;

/** A user record (entity or raw row): it carries account-only fields. */
const looksLikeUser = (o: Record<string, unknown>) =>
  'tokenVersion' in o || 'twoFactorLastCounter' in o || 'documentDataUrl' in o || ('email' in o && 'name' in o);

/**
 * For public responses that embed users anywhere (a club's members, a tournament's creator
 * and players...): a copy with every nested user's private fields removed.
 */
export function stripPrivateUsers<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripPrivateUsers(v)) as T;
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const isUser = looksLikeUser(source);
  for (const [key, v] of Object.entries(source)) {
    if (isUser && (PRIVATE_USER_FIELDS as readonly string[]).includes(key)) continue;
    out[key] = stripPrivateUsers(v);
  }
  return out as T;
}
