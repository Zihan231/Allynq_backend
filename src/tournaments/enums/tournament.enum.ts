export enum TournamentType {
  PVP = 'pvp',
  CVC = 'cvc',
}

export enum TournamentPreset {
  SIXTEEN_V_SIXTEEN = '16v16',
  TWELVE_V_TWELVE = '12v12',
  EIGHT_V_EIGHT = '8v8',
  FOUR_V_FOUR = '4v4',
  CUSTOM = 'custom',
  /** Legacy: kept so existing tournaments still load; no longer accepted on create. */
  ELEVEN_V_ELEVEN = '11v11',
}

/** Starters and substitutes for each selectable CvC roster preset. */
export const TOURNAMENT_PRESET_ROSTERS: Partial<
  Record<TournamentPreset, { startersCount: number; subsCount: number }>
> = {
  [TournamentPreset.SIXTEEN_V_SIXTEEN]: { startersCount: 16, subsCount: 8 },
  [TournamentPreset.TWELVE_V_TWELVE]: { startersCount: 12, subsCount: 6 },
  [TournamentPreset.EIGHT_V_EIGHT]: { startersCount: 8, subsCount: 4 },
  [TournamentPreset.FOUR_V_FOUR]: { startersCount: 4, subsCount: 2 },
};

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
