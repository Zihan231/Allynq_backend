export enum BloodGroup {
  A_POS = 'A+',
  A_NEG = 'A-',
  B_POS = 'B+',
  B_NEG = 'B-',
  AB_POS = 'AB+',
  AB_NEG = 'AB-',
  O_POS = 'O+',
  O_NEG = 'O-',
}

export enum DocumentType {
  NATIONAL_ID = 'national_id',
  PASSPORT = 'passport',
  BIRTH_CERTIFICATE = 'birth_certificate',
  DRIVER_LICENSE = 'driver_license',
  UNIVERSITY_DOCS = 'university_docs',
  COLLEGE_DOCS = 'college_docs',
}

export enum VerificationLevel {
  NONE = 0,
  BASIC = 1,
  INTERMEDIATE = 2,
  FULL = 3,
}

export enum SquadTeam {
  MAIN = 'Main',
  ACADEMY = 'Academy',
  LEGEND = 'Legend',
}

export enum ClubRole {
  PRESIDENT = 'President',
  GENERAL_SECRETARY = 'General Secretary',
  CAPTAIN = 'Captain',
  VICE_CAPTAIN = 'Vice-Captain',
  ACADEMY_CAPTAIN = 'Academy Captain',
  MANAGER = 'Manager',
  PLAYER = 'Player',
}

export enum CommunityRole {
  PRESIDENT = 'President',
  VICE_PRESIDENT = 'Vice President',
  TEAM_MANAGER = 'Team Manager',
  HEAD_OF_DISCIPLINE = 'Head of Discipline',
  SCOUT = 'Scout',
  MEMBER = 'Member',
}

export enum LineupStatus {
  STARTER = 'Starter',
  SUB = 'Sub',
  NONE = 'None',
}

/** System-wide staff roles, above any club or community role. */
/**
 * Which eFootball version someone plays: mobile, or console (PlayStation / Xbox,
 * and PC, which plays together with console). Console tournaments take console
 * players only.
 */
export enum GamingPlatform {
  MOBILE = 'mobile',
  CONSOLE = 'console',
}

export enum SystemRole {
  MODERATOR = 'moderator',
  ADMIN = 'admin',
  SUPER_ADMIN = 'super_admin',
}

/** Rank of each system role: a staff member can only act on users ranked below them. */
export const SYSTEM_ROLE_RANK: Record<SystemRole, number> = {
  [SystemRole.MODERATOR]: 1,
  [SystemRole.ADMIN]: 2,
  [SystemRole.SUPER_ADMIN]: 3,
};

export type VerificationStatus = 'none' | 'pending' | 'approved' | 'rejected';
