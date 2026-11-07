import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Club } from '../../clubs/entities/club.entity.js';
import { User } from '../../users/entities/user.entity.js';
import type { PaymentMethod } from '../../transfers/entities/transfer-offer.entity.js';

/** The two sides of a coaching deal. */
export type CoachingParty = 'coach' | 'club';

/**
 * pending (negotiating) → active (he coaches the club until endsAt) → completed; or ended
 * early by either side; or declined / cancelled / expired before it starts.
 * An agreed deal waits as `scheduled` while the coach still has another club.
 */
export type CoachingStatus = 'pending' | 'scheduled' | 'active' | 'completed' | 'ended' | 'declined' | 'cancelled' | 'expired';
export const OPEN_COACHING_STATUSES: CoachingStatus[] = ['pending', 'scheduled', 'active'];

export interface CoachingBid {
  party: CoachingParty;
  byUserId: string;
  feeTk: number;
  days: number;
  message: string | null;
  at: string;
}

/**
 * A club hires a coach for a number of days for a fee. The club pays: the fee is held
 * while the deal is open and paid to the coach (minus the platform's cut) when it's agreed.
 */
@Entity('coaching_deals')
export class CoachingDeal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  coachUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'coachUserId' })
  coach?: Relation<User>;

  @Column({ type: 'varchar', length: 36 })
  clubId!: string;

  @ManyToOne(() => Club, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clubId' })
  club?: Relation<Club>;

  /** Who proposed it: the coach (a request) or the club (an offer). */
  @Column({ type: 'varchar', length: 8 })
  origin!: CoachingParty;

  /** Who answers next while pending. */
  @Column({ type: 'varchar', length: 8 })
  turn!: CoachingParty;

  @Column({ type: 'int' })
  feeTk!: number;

  /** Club money held for the deal right now. */
  @Column({ type: 'int', default: 0 })
  heldTk!: number;

  @Column({ type: 'int' })
  days!: number;

  /** The platform's cut, fixed when the deal is agreed. */
  @Column({ type: 'int', nullable: true })
  commissionPct!: number | null;

  @Column({ type: 'int', nullable: true })
  commissionTk!: number | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: CoachingStatus;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ type: 'json', default: () => "(JSON_ARRAY())" })
  bids!: CoachingBid[];

  @Column({ type: 'varchar', length: 36 })
  createdByUserId!: string;

  @Column({ type: 'datetime', precision: 6 })
  expiresAt!: Date;

  @Column({ type: 'varchar', length: 16, nullable: true })
  paymentMethod!: PaymentMethod | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  paymentRef!: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  paidAt!: Date | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  endsAt!: Date | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  endedAt!: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  endReason!: 'time' | 'coach' | 'club' | 'staff' | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt!: Date;
}
