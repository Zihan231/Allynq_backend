import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { PlayerLoan, type LoanParty } from './player-loan.entity.js';

/** One step of a loan negotiation: the opening fee, then every counter-offer, oldest first. */
@Entity('player_loan_bids')
@Index('IDX_player_loan_bids_loan', ['loanId', 'createdAt'])
export class PlayerLoanBid {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  loanId!: string;

  @ManyToOne(() => PlayerLoan, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'loanId' })
  loan?: Relation<PlayerLoan>;

  @Column({ type: 'varchar', length: 8 })
  party!: LoanParty;

  @Column({ type: 'uuid' })
  byUserId!: string;

  @Column({ type: 'int' })
  feeTk!: number;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
