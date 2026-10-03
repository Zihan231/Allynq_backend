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
export type TransferOfferStatus = 'pending' | 'scheduled' | 'completed' | 'declined' | 'cancelled' | 'expired';

export type PaymentMethod = 'bkash' | 'nagad' | 'card';

@Entity('transfer_offers')
export class TransferOffer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 24 })
  kind!: TransferOfferKind;

  @Column({ type: 'uuid' })
  playerUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playerUserId' })
  player?: Relation<User>;

  /** The player's club when the offer was made (null if he had none). */
  @Column({ type: 'uuid', nullable: true })
  fromClubId!: string | null;

  @ManyToOne(() => Club, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'fromClubId' })
  fromClub?: Relation<Club> | null;

  @Column({ type: 'uuid' })
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

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ type: 'uuid' })
  createdByUserId!: string;

  @Column({ type: 'uuid', nullable: true })
  respondedByUserId!: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  playerSignedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  clubSignedByUserId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  clubSignedAt!: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  paymentMethod!: PaymentMethod | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  paymentRef!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  /** While scheduled: the tournament the player has to finish first. */
  @Column({ type: 'uuid', nullable: true })
  scheduledTournamentId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
