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
