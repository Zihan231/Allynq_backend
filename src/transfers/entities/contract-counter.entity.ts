import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * The running number behind contract numbers (ALQ-2026-000042). One row, id 1. It replaces PostgreSQL's
 * `contract_no_seq` sequence, which MySQL doesn't have: see `nextContractSeq` in `contracts.ts`.
 */
@Entity('contract_counters')
export class ContractCounter {
  @PrimaryColumn({ type: 'int' })
  id!: number;

  @Column({ type: 'int', default: 0 })
  value!: number;
}
