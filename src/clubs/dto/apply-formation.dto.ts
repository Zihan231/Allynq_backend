import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export const SUPPORTED_FORMATIONS = [
  '4-4-2',
  '4-3-3',
  '4-3-2-1',
  '4-3-1-2',
  '4-2-3-1',
  '4-2-1-3',
  '4-1-4-1',
  '4-1-2-3',
  '3-4-3',
  '3-2-4-1',
  '3-2-3-2',
  '3-1-4-2',
  '5-3-2',
  '5-2-2-1',
  '5-2-1-2',
] as const;

export type SupportedFormation = (typeof SUPPORTED_FORMATIONS)[number];

export class ApplyFormationDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(SUPPORTED_FORMATIONS as unknown as string[], {
    message: `formation must be one of: ${SUPPORTED_FORMATIONS.join(', ')}`,
  })
  formation!: SupportedFormation;
}
