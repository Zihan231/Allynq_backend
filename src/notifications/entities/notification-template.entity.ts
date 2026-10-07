import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Staff wording for a coded notification, in English and (optionally) Bangla. Placeholders
 * use the app's `{name}` style. The app shows it instead of its built-in wording.
 */
@Entity('notification_templates')
export class NotificationTemplate {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  titleTemplate!: string;

  @Column({ type: 'text' })
  messageTemplate!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  titleTemplateBn!: string | null;

  @Column({ type: 'text', nullable: true })
  messageTemplateBn!: string | null;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'uuid', nullable: true })
  updatedById!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
