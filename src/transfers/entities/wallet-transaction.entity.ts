import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * - top_up: demo funds added;
 * - hold: money taken for an offer (balance → held);
 * - refund: a hold returned (held → balance);
 * - payout_sent: a hold paid out (leaves held);
 * - received: money credited for a completed transfer;
 * - adjustment: a correction made by ALLYNQ staff (either sign);
 * - reversal: money moved back when staff reversed a completed transfer (either sign).
 * - purchase: spent in the store (negative).
 */
export type WalletTransactionKind =
  | 'top_up'
  | 'hold'
  | 'refund'
  | 'payout_sent'
  | 'received'
  | 'adjustment'
  | 'reversal'
  | 'purchase';

@Entity('wallet_transactions')
export class WalletTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  walletId!: string;

  /**
   * Amount involved. Negative when money left the spendable balance (hold), positive
   * when it came in (top_up, refund, received). payout_sent is positive and only
   * clears the held amount (it was already taken out by the hold).
   */
  @Column({ type: 'int' })
  amountTk!: number;

  @Column({ type: 'varchar', length: 16 })
  kind!: WalletTransactionKind;

  @Column({ type: 'uuid', nullable: true })
  offerId!: string | null;

  /** The loan it belongs to, for loan fees. */
  @Column({ type: 'uuid', nullable: true })
  loanId!: string | null;

  /** The tournament it belongs to: entry fees and prize money of general tournaments. */
  @Column({ type: 'uuid', nullable: true })
  tournamentId!: string | null;

  /** The store item it paid for (purchases). */
  @Column({ type: 'uuid', nullable: true })
  storeItemId!: string | null;

  /** Who the money went to / came from (display name). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  counterparty!: string | null;

  /** Payment transaction ID shown on receipts. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  reference!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
