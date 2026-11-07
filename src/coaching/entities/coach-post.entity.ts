import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from '../../users/entities/user.entity.js';

export type CoachPostStatus = 'pending' | 'approved' | 'rejected';
export interface CoachPostMedia {
  type: 'image' | 'video';
  url: string;
}

export type PostAuthorRole = 'coach' | 'sponsor';

/**
 * A feed post by a coach (tutorials) or a sponsor (brand posts): text, links and uploads.
 * Shown to others only once staff approve it. (`coachUserId` is the author, either role.)
 */
@Entity('coach_posts')
export class CoachPost {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  coachUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'coachUserId' })
  coach?: Relation<User>;

  /** Who posted it: a coach, or a sponsor (shown as "Sponsored"). */
  @Column({ type: 'varchar', length: 16, default: 'coach' })
  authorRole!: PostAuthorRole;

  @Column({ type: 'text' })
  body!: string;

  /** YouTube (or other) video links. */
  @Column({ type: 'json', default: () => "(JSON_ARRAY())" })
  links!: string[];

  @Column({ type: 'json', default: () => "(JSON_ARRAY())" })
  media!: CoachPostMedia[];

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: CoachPostStatus;

  @Column({ type: 'text', nullable: true })
  rejectReason!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  reviewedById!: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  deletedAt!: Date | null;

  /** Kept in step with the likes / comments / saves tables, for ranking the feed. */
  @Column({ type: 'int', default: 0 })
  likeCount!: number;

  @Column({ type: 'int', default: 0 })
  commentCount!: number;

  @Column({ type: 'int', default: 0 })
  saveCount!: number;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt!: Date;
}
