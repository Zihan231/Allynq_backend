import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type BackupStatus = 'creating' | 'ready' | 'failed';

@Entity('platform_backups')
export class PlatformBackup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16, default: 'creating' })
  status!: BackupStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fileName!: string | null;

  @Column({ type: 'bigint', nullable: true })
  sizeBytes!: string | null;

  @Column({ type: 'char', length: 64, nullable: true })
  checksumSha256!: string | null;

  @Column({ type: 'text', nullable: true })
  failure!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
