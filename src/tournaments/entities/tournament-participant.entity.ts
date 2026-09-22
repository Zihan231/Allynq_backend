import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { Club } from '../../clubs/entities/club.entity.js';
import { User } from '../../users/entities/user.entity.js';
import {
  ParticipantStatus,
  ParticipantType,
} from '../enums/tournament.enum.js';
import { Tournament } from './tournament.entity.js';

export interface RosterPlayer {
  profileId: string;
  name: string;
  inGameId?: string | null;
  position?: string | null;
  shirtNumber?: number | null;
}

export interface TournamentLineup {
  teamId?: string | null;
  teamName?: string | null;
  starters: RosterPlayer[];
  substitutes: RosterPlayer[];
}

@Entity('tournament_participants')
@Index(['tournamentId', 'clubId'], { unique: true, where: '"clubId" IS NOT NULL' })
@Index(['tournamentId', 'userId'], { unique: true, where: '"userId" IS NOT NULL' })
export class TournamentParticipant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Tournament, (t) => t.participants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tournamentId' })
  tournament!: Relation<Tournament>;

  @Column({ type: 'uuid' })
  tournamentId!: string;

  @Column({ type: 'enum', enum: ParticipantType })
  participantType!: ParticipantType;

  @ManyToOne(() => Club, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clubId' })
  club!: Relation<Club> | null;

  @Column({ type: 'uuid', nullable: true })
  clubId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: Relation<User> | null;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'registeredByUserId' })
  registeredByUser!: Relation<User> | null;

  @Column({ type: 'uuid', nullable: true })
  registeredByUserId!: string | null;

  @Column({ type: 'enum', enum: ParticipantStatus, default: ParticipantStatus.REGISTERED })
  status!: ParticipantStatus;

  @Column({ type: 'jsonb', nullable: true })
  lineup!: TournamentLineup | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  submittedAt!: Date | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'submittedByUserId' })
  submittedByUser!: Relation<User> | null;

  @Column({ type: 'uuid', nullable: true })
  submittedByUserId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
