import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { TransferOffer, type TransferOfferParty } from './transfer-offer.entity.js';

/** One step of a negotiation: the opening amount, then every counter-offer, oldest first. */
@Entity('transfer_offer_bids')
@Index('IDX_transfer_offer_bids_offer', ['offerId', 'createdAt'])
export class TransferOfferBid {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  offerId!: string;

  @ManyToOne(() => TransferOffer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offerId' })
  offer?: Relation<TransferOffer>;

  /** Who made this bid. */
  @Column({ type: 'varchar', length: 8 })
  party!: TransferOfferParty;

  @Column({ type: 'uuid' })
  byUserId!: string;

  @Column({ type: 'int' })
  amountTk!: number;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
