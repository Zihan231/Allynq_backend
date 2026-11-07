import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** One thing a user did (joined a club, signed a contract, uploaded evidence…), for the activity timeline. */
@Entity('activity_events')
export class ActivityEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar', length: 48 })
  type!: string;

  @Column({ type: 'varchar', length: 24, nullable: true })
  targetType!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  targetId!: string | null;

  @Column({ type: 'text' })
  summary!: string;

  @Column({ type: 'json', nullable: true })
  meta!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;
}
