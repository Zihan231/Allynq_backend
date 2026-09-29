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

export type TimeRequestStatus = 'pending' | 'accepted' | 'declined' | 'expired';

/**
 * A player's request to move their game to another start time (same date).
 * It only takes effect if the opponent accepts; otherwise the system time stays.
 */
@Entity('tournament_game_time_requests')
@Index(['gameId', 'status'])
export class TournamentGameTimeRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => TournamentMatchGame, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game?: Relation<TournamentMatchGame>;

  @Column({ type: 'uuid' })
  gameId!: string;

  @Column({ type: 'uuid' })
  requestedByUserId!: string;

  @Column({ type: 'timestamp with time zone' })
  proposedStart!: Date;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: TimeRequestStatus;

  @Column({ type: 'timestamp with time zone', nullable: true })
  respondedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
