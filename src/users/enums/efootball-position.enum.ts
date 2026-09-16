export enum EfootballPosition {
  GK = 'GK',
  CB = 'CB',
  LB = 'LB',
  RB = 'RB',
  DMF = 'DMF',
  CMF = 'CMF',
  LMF = 'LMF',
  RMF = 'RMF',
  AMF = 'AMF',
  LWF = 'LWF',
  RWF = 'RWF',
  SS = 'SS',
  CF = 'CF',
}

export const COMPATIBLE_POSITIONS: Record<EfootballPosition, EfootballPosition[]> = {
  [EfootballPosition.GK]: [EfootballPosition.GK],
  [EfootballPosition.CB]: [
    EfootballPosition.CB,
    EfootballPosition.LB,
    EfootballPosition.RB,
    EfootballPosition.DMF,
  ],
  [EfootballPosition.LB]: [
    EfootballPosition.LB,
    EfootballPosition.CB,
    EfootballPosition.LMF,
    EfootballPosition.LWF,
  ],
  [EfootballPosition.RB]: [
    EfootballPosition.RB,
    EfootballPosition.CB,
    EfootballPosition.RMF,
    EfootballPosition.RWF,
  ],
  [EfootballPosition.DMF]: [
    EfootballPosition.DMF,
    EfootballPosition.CMF,
    EfootballPosition.CB,
  ],
  [EfootballPosition.CMF]: [
    EfootballPosition.CMF,
    EfootballPosition.DMF,
    EfootballPosition.AMF,
    EfootballPosition.LMF,
    EfootballPosition.RMF,
  ],
  [EfootballPosition.LMF]: [
    EfootballPosition.LMF,
    EfootballPosition.LB,
    EfootballPosition.LWF,
    EfootballPosition.CMF,
  ],
  [EfootballPosition.RMF]: [
    EfootballPosition.RMF,
    EfootballPosition.RB,
    EfootballPosition.RWF,
    EfootballPosition.CMF,
  ],
  [EfootballPosition.AMF]: [
    EfootballPosition.AMF,
    EfootballPosition.CMF,
    EfootballPosition.SS,
    EfootballPosition.LWF,
    EfootballPosition.RWF,
  ],
  [EfootballPosition.LWF]: [
    EfootballPosition.LWF,
    EfootballPosition.LMF,
    EfootballPosition.SS,
    EfootballPosition.CF,
  ],
  [EfootballPosition.RWF]: [
    EfootballPosition.RWF,
    EfootballPosition.RMF,
    EfootballPosition.SS,
    EfootballPosition.CF,
  ],
  [EfootballPosition.SS]: [
    EfootballPosition.SS,
    EfootballPosition.CF,
    EfootballPosition.AMF,
    EfootballPosition.LWF,
    EfootballPosition.RWF,
  ],
  [EfootballPosition.CF]: [
    EfootballPosition.CF,
    EfootballPosition.SS,
    EfootballPosition.LWF,
    EfootballPosition.RWF,
  ],
};

export function normalizePosition(pos: string | null | undefined): EfootballPosition | null {
  if (!pos) return null;
  const upper = pos.toUpperCase().trim();
  if (Object.values(EfootballPosition).includes(upper as EfootballPosition)) {
    return upper as EfootballPosition;
  }
  // Standard aliases
  if (upper === 'ST') return EfootballPosition.CF;
  if (upper === 'CDM' || upper === 'DM') return EfootballPosition.DMF;
  if (upper === 'CAM' || upper === 'AP') return EfootballPosition.AMF;
  if (upper === 'CM') return EfootballPosition.CMF;
  if (upper === 'LW') return EfootballPosition.LWF;
  if (upper === 'RW') return EfootballPosition.RWF;
  if (upper === 'LM') return EfootballPosition.LMF;
  if (upper === 'RM') return EfootballPosition.RMF;
  if (upper === 'GOALKEEPER') return EfootballPosition.GK;
  return null;
}
