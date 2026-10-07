import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const REPORT_TARGETS = ['user', 'club', 'community', 'tournament', 'match'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_REASONS = [
  'cheating',
  'fake_result',
  'abuse',
  'fake_account',
  'inappropriate_content',
  'payment_issue',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ['open', 'in_review', 'action_taken', 'rejected', 'withdrawn'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const ACTIVE_REPORT_STATUSES: ReportStatus[] = ['open', 'in_review'];

/** Who the report is filed as: the player alone, or a leader on behalf of their club / community. */
export type ReportedAs = 'self' | 'club' | 'community';

@Entity('reports')
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  reporterId!: string;

  @Column({ type: 'varchar', length: 16, default: 'self' })
  reportedAs!: ReportedAs;

  @Column({ type: 'uuid', nullable: true })
  reporterClubId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reporterCommunityId!: string | null;

  @Column({ type: 'varchar', length: 16 })
  targetType!: ReportTarget;

  @Column({ type: 'uuid' })
  targetId!: string;

  /** The target's name when reported, kept even if it is renamed or deleted later. */
  @Column({ type: 'varchar', length: 255 })
  targetName!: string;

  /** Club / community the target belongs to, so staff can filter reports by them. */
  @Column({ type: 'uuid', nullable: true })
  contextClubId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  contextCommunityId!: string | null;

  @Column({ type: 'varchar', length: 32 })
  reason!: ReportReason;

  @Column({ type: 'text' })
  details!: string;

  /** Proof images, served from /uploads/reports/…. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  attachments!: string[];

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status!: ReportStatus;

  @Column({ type: 'uuid', nullable: true })
  assigneeId!: string | null;

  /** What staff tell the reporter when closing it. */
  @Column({ type: 'text', nullable: true })
  resolution!: string | null;

  /** The action taken on the target, if any (warn, suspend, ban, bin). */
  @Column({ type: 'varchar', length: 24, nullable: true })
  resolutionAction!: string | null;

  /** Rejected as a false report: the reporter got a strike. */
  @Column({ type: 'boolean', default: false })
  falseReport!: boolean;

  @Column({ type: 'uuid', nullable: true })
  resolvedById!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
