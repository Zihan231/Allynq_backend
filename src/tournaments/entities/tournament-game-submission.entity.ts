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
import { TournamentMatchGame } from './tournament-match-game.entity.js';

/**
 * One side's claimed result for a game, with evidence (storage object paths).
 * Each side has at most one submission per game; resubmitting replaces it.
 */
@Entity('tournament_game_submissions')
@Index(['gameId', 'side'], { unique: true })
export class TournamentGameSubmission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => TournamentMatchGame, (game) => game.submissions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game?: Relation<TournamentMatchGame>;

  @Column({ type: 'uuid' })
  gameId!: string;

  @Column({ type: 'varchar', length: 1 })
  side!: 'A' | 'B';

  @Column({ type: 'uuid' })
  submittedByUserId!: string;

  @Column({ type: 'int' })
  goalsA!: number;

  @Column({ type: 'int' })
  goalsB!: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  screenshotPaths!: string[];

  @Column({ type: 'varchar', length: 512, nullable: true })
  videoPath!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
