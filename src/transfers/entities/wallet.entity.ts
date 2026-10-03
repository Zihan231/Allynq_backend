import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

export type WalletOwnerType = 'user' | 'club';

/**
 * Demo wallet for a player or a club. `balanceTk` is what can be spent;
 * `heldTk` is money taken for open offers / scheduled transfers (refunded or
 * paid out later).
 */
@Entity('wallets')
@Unique('UQ_wallets_owner', ['ownerType', 'ownerId'])
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 8 })
  ownerType!: WalletOwnerType;

  @Column({ type: 'uuid' })
  ownerId!: string;

  @Column({ type: 'int', default: 0 })
  balanceTk!: number;

  @Column({ type: 'int', default: 0 })
  heldTk!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
