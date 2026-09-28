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
import { TournamentMatchGame } from './tournament-match-game.entity.js';
import { TournamentParticipant } from './tournament-participant.entity.js';
import { Tournament } from './tournament.entity.js';

export type MatchStage = 'group' | 'knockout';
/** scheduled → in_review (results submitted) → completed; bye = walkover, no games. */
export type MatchStatus = 'scheduled' | 'in_review' | 'completed' | 'bye';

/** One fixture between two entrants (clubs in CvC, players in PvP). */
@Entity('tournament_matches')
@Index(['tournamentId', 'stage'])
export class TournamentMatch {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Tournament, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tournamentId' })
  tournament?: Relation<Tournament>;

  @Column({ type: 'uuid' })
  tournamentId!: string;

  @Column({ type: 'varchar', length: 16 })
  stage!: MatchStage;

  /** Group letter (A, B …) for group-stage fixtures. */
  @Column({ type: 'varchar', length: 4, nullable: true })
  groupLabel!: string | null;

  /** Matchday in the group stage, round number in the knockout. */
  @Column({ type: 'int' })
  round!: number;

  @Column({ type: 'varchar', length: 32 })
  roundName!: string;

  @Column({ type: 'int' })
  matchNumber!: number;

  @ManyToOne(() => TournamentParticipant, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'participantAId' })
  participantA?: Relation<TournamentParticipant> | null;

  @Column({ type: 'uuid', nullable: true })
  participantAId!: string | null;

  @ManyToOne(() => TournamentParticipant, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'participantBId' })
  participantB?: Relation<TournamentParticipant> | null;

  @Column({ type: 'uuid', nullable: true })
  participantBId!: string | null;

  /** Knockout: the fixture the winner moves into, and on which side. */
  @Column({ type: 'uuid', nullable: true })
  nextMatchId!: string | null;

  @Column({ type: 'varchar', length: 1, nullable: true })
  nextSlot!: 'A' | 'B' | null;

  @Column({ type: 'varchar', length: 24, default: 'scheduled' })
  status!: MatchStatus;

  /** Fixture score: games won (CvC) or goals (PvP). */
  @Column({ type: 'int', nullable: true })
  scoreA!: number | null;

  @Column({ type: 'int', nullable: true })
  scoreB!: number | null;

  /** Aggregate goals across the fixture's games. */
  @Column({ type: 'int', nullable: true })
  goalsA!: number | null;

  @Column({ type: 'int', nullable: true })
  goalsB!: number | null;

  @Column({ type: 'uuid', nullable: true })
  winnerParticipantId!: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  completedAt!: Date | null;

  @OneToMany(() => TournamentMatchGame, (game) => game.match)
  games?: Relation<TournamentMatchGame[]>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
