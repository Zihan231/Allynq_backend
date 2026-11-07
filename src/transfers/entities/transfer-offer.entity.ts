import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Club } from '../../clubs/entities/club.entity.js';
import { User } from '../../users/entities/user.entity.js';

/**
 * - player_proposal: a free player offers himself to a club for an amount (club pays him on accepting);
 * - club_offer: a club offers a free player an amount;
 * - renewal: a club offers its own player a new contract for an amount;
 * - buyout: a club buys a locked player by paying his current fee to his club.
 */
export type TransferOfferKind = 'player_proposal' | 'club_offer' | 'renewal' | 'buyout';

/** pending → accepted → (scheduled, while the player finishes a tournament) → completed; or declined / cancelled / expired. */
export type TransferOfferStatus = 'pending' | 'scheduled' | 'completed' | 'declined' | 'cancelled' | 'expired' | 'reversed';

export type PaymentMethod = 'bkash' | 'nagad' | 'card';

/** The two sides of a deal: the player, and the club he would sign for (its President / GS). */
export type TransferOfferParty = 'player' | 'club';

@Entity('transfer_offers')
export class TransferOffer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 24 })
  kind!: TransferOfferKind;

  @Column({ type: 'varchar', length: 36 })
  playerUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playerUserId' })
  player?: Relation<User>;

  /** The player's club when the offer was made (null if he had none). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  fromClubId!: string | null;

  @ManyToOne(() => Club, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'fromClubId' })
  fromClub?: Relation<Club> | null;

  @Column({ type: 'varchar', length: 36 })
  toClubId!: string;

  @ManyToOne(() => Club, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'toClubId' })
  toClub?: Relation<Club>;

  @Column({ type: 'int' })
  amountTk!: number;

  /** Who receives the money: the player, or (buyouts) his current club. */
  @Column({ type: 'varchar', length: 8 })
  payeeType!: 'player' | 'club';

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: TransferOfferStatus;

  /**
   * Who answers next while pending: accept, reject or counter with a new amount
   * (the other side can only withdraw). Flips with every counter-offer.
   */
  @Column({ type: 'varchar', length: 8 })
  turn!: TransferOfferParty;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ type: 'varchar', length: 36 })
  createdByUserId!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  respondedByUserId!: string | null;

  @Column({ type: 'datetime', precision: 6 })
  expiresAt!: Date;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  playerSignedAt!: Date | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  clubSignedByUserId!: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  clubSignedAt!: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  paymentMethod!: PaymentMethod | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  paymentRef!: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  paidAt!: Date | null;

  /**
   * Club money held for this deal right now: the club's last bid while pending, the
   * agreed amount once accepted; 0 after payout or refund. After a player's counter
   * it can differ from `amountTk` until the club answers.
   */
  @Column({ type: 'int', default: 0 })
  heldTk!: number;

  /** While scheduled: the tournament the player has to finish first. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  scheduledTournamentId!: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt!: Date;
}
