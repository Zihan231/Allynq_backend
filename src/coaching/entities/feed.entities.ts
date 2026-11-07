import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { CoachPost } from './coach-post.entity.js';

/** A user liked a post. */
@Entity('coach_post_likes')
export class CoachPostLike {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  postId!: string;

  @PrimaryColumn({ type: 'varchar', length: 36 })
  userId!: string;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;
}

/** A user saved a post to watch later (private). */
@Entity('coach_post_saves')
export class CoachPostSave {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  postId!: string;

  @PrimaryColumn({ type: 'varchar', length: 36 })
  userId!: string;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;
}

/** A post scrolled into view: seen posts sink in the user's feed. */
@Entity('coach_post_views')
export class CoachPostView {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  postId!: string;

  @PrimaryColumn({ type: 'varchar', length: 36 })
  userId!: string;

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  seenAt!: Date;
}

/** A user follows a coach: his posts rank higher for them. */
@Entity('coach_follows')
export class CoachFollow {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  coachUserId!: string;

  @PrimaryColumn({ type: 'varchar', length: 36 })
  followerUserId!: string;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;
}

/** A comment under a post (public right away; staff and the author can delete it). */
@Entity('coach_post_comments')
export class CoachPostComment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  postId!: string;

  @ManyToOne(() => CoachPost, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post?: Relation<CoachPost>;

  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: Relation<User>;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;
}
