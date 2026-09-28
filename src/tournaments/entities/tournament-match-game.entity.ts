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
import { TournamentGameSubmission } from './tournament-game-submission.entity.js';
import { TournamentMatch } from './tournament-match.entity.js';

/** pending → submitted (evidence in) → approved / rejected by an official. */
export type GameStatus = 'pending' | 'submitted' | 'approved' | 'rejected';

/**
 * A single 1v1 game inside a fixture. PvP fixtures have one game; CvC fixtures
 * have one game per starter pairing (lineup slot i vs slot i), plus an optional
 * decider when a knockout fixture ends level.
 */
@Entity('tournament_match_games')
@Index(['matchId', 'slot'], { unique: true })
export class TournamentMatchGame {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => TournamentMatch, (match) => match.games, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'matchId' })
  match?: Relation<TournamentMatch>;

  @Column({ type: 'uuid' })
  matchId!: string;

  /** 1-based pairing number (lineup slot). */
  @Column({ type: 'int' })
  slot!: number;

  @Column({ type: 'boolean', default: false })
  isDecider!: boolean;

  @Column({ type: 'uuid', nullable: true })
  playerAProfileId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  playerAUserId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  playerAName!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  playerADpUrl!: string | null;

  @Column({ type: 'uuid', nullable: true })
  playerBProfileId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  playerBUserId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  playerBName!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  playerBDpUrl!: string | null;

  /** Official result, set when a reviewer approves the game. */
  @Column({ type: 'int', nullable: true })
  goalsA!: number | null;

  @Column({ type: 'int', nullable: true })
  goalsB!: number | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: GameStatus;

  @Column({ type: 'uuid', nullable: true })
  reviewedByUserId!: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  reviewNote!: string | null;

  @OneToMany(() => TournamentGameSubmission, (submission) => submission.game)
  submissions?: Relation<TournamentGameSubmission[]>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
