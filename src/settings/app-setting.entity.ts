import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Adjustable app-wide settings, one JSON document per key (e.g. "transfers"). */
@Entity('app_settings')
export class AppSetting {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ type: 'jsonb' })
  value!: Record<string, unknown>;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
