import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Club } from '../../clubs/entities/club.entity.js';
import { User } from '../../users/entities/user.entity.js';
import type { PaymentMethod } from './transfer-offer.entity.js';

/** The two clubs of a loan: the parent club (holds his contract) and the borrowing club (pays the fee). */
export type LoanParty = 'parent' | 'borrower';

/**
 * pending (negotiating) → scheduled (he finishes a tournament with the parent club first)
 * → active (playing for the borrower) → returning (done, waits for a running tournament)
 * → completed; or declined / cancelled / expired before it starts.
 */
export type LoanStatus = 'pending' | 'scheduled' | 'active' | 'returning' | 'completed' | 'declined' | 'cancelled' | 'expired';

/** Why a loan ended: its matches were played, its days ran out, the borrower bought him, staff, or a club was deleted. */
export type LoanEndReason = 'matches' | 'time' | 'bought' | 'staff' | 'club_deleted';

/** Statuses of a loan that's still open (one per player at a time). */
export const OPEN_LOAN_STATUSES: LoanStatus[] = ['pending', 'scheduled', 'active', 'returning'];

/**
 * A player lent by his club (the parent, which keeps his contract) to another club for
 * a number of matches, or at most `maxDays`. The borrowing club pays the fee.
 */
@Entity('player_loans')
export class PlayerLoan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  playerUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playerUserId' })
  player?: Relation<User>;

  @Column({ type: 'uuid' })
  parentClubId!: string;

  @ManyToOne(() => Club, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parentClubId' })
  parentClub?: Relation<Club>;

  @Column({ type: 'uuid' })
  borrowClubId!: string;

  @ManyToOne(() => Club, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'borrowClubId' })
  borrowClub?: Relation<Club>;

  /** His contract with the parent club (unchanged by the loan). */
  @Column({ type: 'uuid', nullable: true })
  contractId!: string | null;

  /** The fee on the table now (changes with every counter-offer). */
  @Column({ type: 'int' })
  feeTk!: number;

  /** Borrowing-club money held for the loan right now; paid to the parent club when it starts. */
  @Column({ type: 'int', default: 0 })
  heldTk!: number;

  /** Matches he plays for the borrowing club before he returns. */
  @Column({ type: 'int' })
  matches!: number;

  /** Days after the start when he returns, even if he hasn't played all the matches. */
  @Column({ type: 'int' })
  maxDays!: number;

  @Column({ type: 'int', default: 0 })
  matchesPlayed!: number;

  /** Who answers next while pending. */
  @Column({ type: 'varchar', length: 8 })
  turn!: LoanParty;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: LoanStatus;

  @Column({ type: 'varchar', length: 16, nullable: true })
  endReason!: LoanEndReason | null;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ type: 'uuid' })
  createdByUserId!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'varchar', length: 16, nullable: true })
  paymentMethod!: PaymentMethod | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  paymentRef!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  /** While scheduled / returning: the tournament he has to finish first. */
  @Column({ type: 'uuid', nullable: true })
  scheduledTournamentId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  /** startedAt + maxDays. */
  @Column({ type: 'timestamptz', nullable: true })
  endsBy!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
