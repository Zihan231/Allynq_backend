import { PartialType } from '@nestjs/mapped-types';
import { CreateClubDto } from './create-club.dto.js';

export class UpdateClubDto extends PartialType(CreateClubDto) {}
