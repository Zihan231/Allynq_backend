import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from '../../users/entities/user.entity.js';

export type CoachPostStatus = 'pending' | 'approved' | 'rejected';
export interface CoachPostMedia {
  type: 'image' | 'video';
  url: string;
}

/** A coach's tutorial post: text, YouTube links and uploads. Shown to others only once staff approve it. */
@Entity('coach_posts')
export class CoachPost {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  coachUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'coachUserId' })
  coach?: Relation<User>;

  @Column({ type: 'text', default: '' })
  body!: string;

  /** YouTube (or other) video links. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  links!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  media!: CoachPostMedia[];

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: CoachPostStatus;

  @Column({ type: 'text', nullable: true })
  rejectReason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedById!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  /** Kept in step with the likes / comments / saves tables, for ranking the feed. */
  @Column({ type: 'int', default: 0 })
  likeCount!: number;

  @Column({ type: 'int', default: 0 })
  commentCount!: number;

  @Column({ type: 'int', default: 0 })
  saveCount!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
