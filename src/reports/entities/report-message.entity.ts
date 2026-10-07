import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** A message in a report's thread: reporter ↔ staff, or an internal staff note. */
@Entity('report_messages')
export class ReportMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  reportId!: string;

  @Column({ type: 'uuid', nullable: true })
  authorId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  authorName!: string;

  @Column({ type: 'boolean', default: false })
  fromStaff!: boolean;

  /** Staff-only note; never shown to the reporter. */
  @Column({ type: 'boolean', default: false })
  internal!: boolean;

  @Column({ type: 'text' })
  body!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
