import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity.js';

export type NotificationType =
  | 'club_join_request'
  | 'club_member_joined'
  | 'community_join_request'
  | 'tournament_update'
  | 'system';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: Relation<User>;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'varchar', length: 64, default: 'system' })
  type!: NotificationType;

  @Column({ type: 'varchar', length: 512, nullable: true })
  link!: string | null;

  @Column({ type: 'boolean', default: false })
  read!: boolean;

  // With a time zone, so the moment reads the same whatever the server's local zone is.
  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt!: Date;
}
