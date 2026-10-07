import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Staff override for a coded notification's English fallback text. */
@Entity('notification_templates')
export class NotificationTemplate {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  titleTemplate!: string;

  @Column({ type: 'text' })
  messageTemplate!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'uuid', nullable: true })
  updatedById!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
