import { PartialType } from '@nestjs/mapped-types';
import { CreateEfootballProfileDto } from './create-efootball-profile.dto.js';

export class UpdateEfootballProfileDto extends PartialType(CreateEfootballProfileDto) {}
