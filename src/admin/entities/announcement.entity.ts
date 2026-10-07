import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Who an announcement goes to. */
export type AnnouncementAudience =
  | { type: 'all' }
  | { type: 'staff' }
  | { type: 'leaders' }
  | { type: 'country'; country: string }
  | { type: 'community'; id: string }
  | { type: 'club'; id: string };

export type AnnouncementStatus = 'scheduled' | 'sent' | 'cancelled';

/** A message from ALLYNQ staff, delivered as a notification now or at a scheduled time. */
@Entity('announcements')
export class Announcement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  title!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  link!: string | null;

  @Column({ type: 'jsonb' })
  audience!: AnnouncementAudience;

  /** Human-readable audience, e.g. "Members of Padma Premier League". */
  @Column({ type: 'varchar', length: 255 })
  audienceLabel!: string;

  @Column({ type: 'varchar', length: 16, default: 'scheduled' })
  status!: AnnouncementStatus;

  @Column({ type: 'timestamptz', nullable: true })
  scheduledFor!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  recipients!: number;

  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
