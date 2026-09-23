import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { Community } from '../../communities/entities/community.entity.js';
import { User } from '../../users/entities/user.entity.js';
import {
  TournamentPreset,
  TournamentStatus,
  TournamentType,
} from '../enums/tournament.enum.js';
import { TournamentParticipant } from './tournament-participant.entity.js';

export interface BracketMatch {
  id: string;
  round: string; // e.g. "Round of 16", "Quarter-final", "Semi-final", "Final"
  matchNumber: number;
  participantA?: {
    id: string;
    name: string;
    dpUrl?: string | null;
    score?: number | null;
  } | null;
  participantB?: {
    id: string;
    name: string;
    dpUrl?: string | null;
    score?: number | null;
  } | null;
  winnerId?: string | null;
  status: 'pending' | 'ongoing' | 'completed';
}

@Entity('tournaments')
export class Tournament {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Index()
  @Column({ type: 'enum', enum: TournamentType })
  type!: TournamentType;

  @Column({ type: 'enum', enum: TournamentStatus, default: TournamentStatus.REGISTRATION_OPEN })
  status!: TournamentStatus;

  @Column({ type: 'enum', enum: TournamentPreset, default: TournamentPreset.ELEVEN_V_ELEVEN })
  preset!: TournamentPreset;

  @Column({ type: 'int', default: 11 })
  startersCount!: number;

  @Column({ type: 'int', default: 5 })
  subsCount!: number;

  @Column({ type: 'int', default: 16 })
  maxParticipants!: number;

  @Column({ type: 'int', default: 0 })
  entryFeeBdt!: number;

  @Column({ type: 'int', default: 0 })
  prizePoolBdt!: number;

  @Column({ type: 'timestamp with time zone', nullable: true })
  registrationDeadline!: Date | null;

  @Column({ type: 'timestamp with time zone' })
  teamSubmissionDeadline!: Date;

  @Column({ type: 'timestamp with time zone' })
  startAt!: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  endAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  bracket!: BracketMatch[] | null;

  @ManyToOne(() => Community, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community!: Relation<Community>;

  @Index()
  @Column({ type: 'uuid' })
  communityId!: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'creatorId' })
  creator!: Relation<User> | null;

  @Column({ type: 'uuid', nullable: true })
  creatorId!: string | null;

  @OneToMany(() => TournamentParticipant, (p) => p.tournament)
  participants?: Relation<TournamentParticipant[]>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
