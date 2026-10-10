import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { Club } from '../../clubs/entities/club.entity.js';
import { Community } from '../../communities/entities/community.entity.js';
import { User } from '../../users/entities/user.entity.js';
import {
  TournamentPreset,
  TournamentStatus,
  TournamentType,
} from '../enums/tournament.enum.js';
import { GamingPlatform } from '../../users/enums/user-attributes.enum.js';
import type { TournamentFormat } from '../bracket/format.js';
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

  /** Mobile or console. A console tournament takes console players only. Fixed at creation. */
  @Index()
  @Column({ type: 'varchar', length: 8, default: GamingPlatform.MOBILE })
  platform!: GamingPlatform;

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

  /** Daily play hours (minutes after local midnight, Dhaka time); null = default 19:00–01:00. */
  @Column({ type: 'smallint', nullable: true })
  playHoursStart!: number | null;

  @Column({ type: 'smallint', nullable: true })
  playHoursEnd!: number | null;

  /** User ids of the match officials (reviewers besides the President / Vice President). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  matchOfficialIds!: string[];

  /** Set when fixtures are generated: 'knockout' or 'groups_knockout'. */
  @Column({ type: 'varchar', length: 24, nullable: true })
  format!: TournamentFormat | null;

  /** Hosting community. Exactly one of `communityId` / `hostClubId` is set. */
  @ManyToOne(() => Community, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'communityId' })
  community!: Relation<Community> | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  communityId!: string | null;

  /** Hosting club (club tournaments are PvP, for the club's members). */
  @ManyToOne(() => Club, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'hostClubId' })
  hostClub!: Relation<Club> | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  hostClubId!: string | null;

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

  /** Set while it sits in the recycle bin: hidden everywhere, restorable until purged. */
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}

export type TournamentHost = { kind: 'community'; id: string } | { kind: 'club'; id: string };

/** Who hosts a tournament: its community, or (for club tournaments) its club. */
export function hostOf(tournament: Pick<Tournament, 'communityId' | 'hostClubId'>): TournamentHost {
  return tournament.hostClubId
    ? { kind: 'club', id: tournament.hostClubId }
    : { kind: 'community', id: tournament.communityId ?? '' };
}

/** App link to a tournament page (optionally with a query such as `?tab=bracket&match=…`). */
export function tournamentLink(
  tournament: Pick<Tournament, 'id' | 'communityId' | 'hostClubId'>,
  query = '',
): string {
  const host = hostOf(tournament);
  const base =
    host.kind === 'club'
      ? `/dashboard/efootball/clubs/${host.id}/tournaments/${tournament.id}`
      : `/dashboard/efootball/community/${host.id}/tournaments/${tournament.id}`;
  return `${base}${query}`;
}

/** App link to the host's tournament list (community or club Tournaments tab). */
export function hostTournamentsLink(tournament: Pick<Tournament, 'communityId' | 'hostClubId'>): string {
  const host = hostOf(tournament);
  return host.kind === 'club'
    ? `/dashboard/efootball/clubs/${host.id}?tab=tournaments`
    : `/dashboard/efootball/community/${host.id}?tab=tournaments`;
}
