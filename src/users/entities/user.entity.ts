import {
  Column,
  CreateDateColumn,
  Entity,
  OneToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { BloodGroup, DocumentType, VerificationLevel } from '../enums/user-attributes.enum.js';
import { EfootballProfile } from './efootball-profile.entity.js';

export type LatLng = { lat: number; lng: number };
export type WorkExperienceEntry = { workplace: string; jobTitle: string };
export type EducationEntry = {
  instituteName: string;
  fieldOfStudy: string;
  instituteType: 'University' | 'College' | 'School' | 'Other';
};

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  dpUrl!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  coverUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  bio!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  facebookUrl!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  facebookProfileName!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  instagramUrl!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  discordUrl!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  inGameId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  deviceName!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  deviceModel!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phoneNumber!: string | null;

  @Column({ type: 'date', nullable: true })
  birthday!: string | null;

  @Column({ type: 'enum', enum: BloodGroup, nullable: true })
  bloodGroup!: BloodGroup | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  country!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  division!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  district!: string | null;

  @Column({ type: 'text', nullable: true })
  permanentAddress!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  currentLocation!: LatLng | null;

  @Column({ type: 'jsonb', nullable: true })
  workExperience!: WorkExperienceEntry[] | null;

  @Column({ type: 'jsonb', nullable: true })
  education!: EducationEntry[] | null;

  @Column({ type: 'enum', enum: DocumentType, nullable: true })
  documentType!: DocumentType | null;

  @Column({ type: 'text', nullable: true })
  documentDataUrl!: string | null;

  @Column({ type: 'enum', enum: VerificationLevel, default: VerificationLevel.NONE })
  verificationLevel!: VerificationLevel;

  @Column({ type: 'jsonb', nullable: true })
  ownedCosmeticIds!: string[] | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  equippedBadgeId!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  equippedTitleId!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  equippedFrameId!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  equippedThemeId!: string | null;

  @OneToOne(() => EfootballProfile, (profile) => profile.user)
  efootballProfile?: Relation<EfootballProfile>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
