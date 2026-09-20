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
import { Club } from './club.entity.js';

export type ClubJoinRequestStatus = 'pending' | 'approved' | 'rejected';

@Entity('club_join_requests')
export class ClubJoinRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  clubId!: string;

  @ManyToOne(() => Club, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clubId' })
  club?: Relation<Club>;

  @Column({ type: 'uuid' })
  requesterUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requesterUserId' })
  requesterUser?: Relation<User>;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: ClubJoinRequestStatus;

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
