import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type SecurityBanKind = 'ip' | 'device';

/** A hashed IP address or client-generated device id that may not use the platform. */
@Entity('security_bans')
@Index('security_bans_lookup_idx', ['kind', 'valueHash'])
export class SecurityBan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  kind!: SecurityBanKind;

  @Column({ type: 'char', length: 64 })
  valueHash!: string;

  /** A safe hint for staff, never the complete device id. */
  @Column({ type: 'varchar', length: 128 })
  valueHint!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  revokedById!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
