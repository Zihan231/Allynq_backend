import { User } from '../entities/user.entity.js';

export type PublicUser = Omit<
  User,
  'email' | 'phoneNumber' | 'permanentAddress' | 'documentDataUrl' | 'documentType' | 'password'
>;

export function serializeUser(user: User, isSelf = false): PublicUser | User {
  // Always remove sensitive password hash
  const { password: _password, ...safeUser } = user as any;

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
    ...publicUser
  } = safeUser;

  return publicUser as PublicUser;
}

export function serializeUsers(users: User[], currentUserId?: string | null): (PublicUser | User)[] {
  return users.map((u) => serializeUser(u, Boolean(currentUserId && u.id === currentUserId)));
}
