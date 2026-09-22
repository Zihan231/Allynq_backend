export enum TournamentType {
  PVP = 'pvp',
  CVC = 'cvc',
}

export enum TournamentPreset {
  ELEVEN_V_ELEVEN = '11v11',
  EIGHT_V_EIGHT = '8v8',
  CUSTOM = 'custom',
}

export enum TournamentStatus {
  REGISTRATION_OPEN = 'registration_open',
  SUBMISSION_PHASE = 'submission_phase',
  ONGOING = 'ongoing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum ParticipantType {
  CLUB = 'club',
  PLAYER = 'player',
}

export enum ParticipantStatus {
  REGISTERED = 'registered',
  LINEUP_SUBMITTED = 'lineup_submitted',
  CONFIRMED = 'confirmed',
  DISQUALIFIED = 'disqualified',
}
