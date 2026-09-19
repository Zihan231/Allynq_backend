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
import { Club } from '../../clubs/entities/club.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { CommunityJoinRequestStatus, CommunityJoinRequestType } from '../enums/community.enum.js';
import { Community } from './community.entity.js';

@Entity('community_join_requests')
export class CommunityJoinRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Community, (community) => community.joinRequests, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community?: Relation<Community>;

  @Column({ type: 'uuid' })
  communityId!: string;

  @Column({ type: 'uuid' })
  requesterUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requesterUserId' })
  requesterUser?: Relation<User>;

  @Column({ type: 'enum', enum: CommunityJoinRequestType })
  targetType!: CommunityJoinRequestType;

  @Column({ type: 'uuid', nullable: true })
  clubId!: string | null;

  @ManyToOne(() => Club, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clubId' })
  club?: Relation<Club> | null;

  @Column({ type: 'enum', enum: CommunityJoinRequestStatus, default: CommunityJoinRequestStatus.PENDING })
  status!: CommunityJoinRequestStatus;

  @Column({ type: 'uuid', nullable: true })
  reviewedByUserId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewedByUserId' })
  reviewedByUser?: Relation<User> | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
