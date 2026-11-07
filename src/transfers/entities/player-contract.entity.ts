import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Club } from '../../clubs/entities/club.entity.js';
import { User } from '../../users/entities/user.entity.js';

export type ContractEndReason = 'transfer' | 'renewal' | 'left' | 'club_deleted' | 'reversed';

/**
 * A player's contract with a club. Transfer fee right now =
 * frozenTk + baseTk × daysLeft / lockDays (see contract-fee.ts). A user has at
 * most one active contract.
 */
@Entity('player_contracts')
export class PlayerContract {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 24, unique: true })
  contractNo!: string;

  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: Relation<User>;

  @Column({ type: 'varchar', length: 36 })
  clubId!: string;

  @ManyToOne(() => Club, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clubId' })
  club?: Relation<Club>;

  /** The offer that created it (null for contracts created at launch). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  offerId!: string | null;

  /** The part of the fee that never decays: what he was paid, or what a buyer paid. */
  @Column({ type: 'int', default: 0 })
  frozenTk!: number;

  /** Snapshot of the fixed fee part and lock length when signed. */
  @Column({ type: 'int' })
  baseTk!: number;

  @Column({ type: 'int' })
  lockDays!: number;

  @Column({ type: 'datetime', precision: 6 })
  startAt!: Date;

  @Column({ type: 'datetime', precision: 6 })
  lockEndsAt!: Date;

  @Column({ type: 'varchar', length: 8, default: 'active' })
  status!: 'active' | 'ended';

  @Column({ type: 'datetime', precision: 6, nullable: true })
  endedAt!: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  endReason!: ContractEndReason | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  notified7dAt!: Date | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  notified1dAt!: Date | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  notifiedFreeAt!: Date | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;
}
