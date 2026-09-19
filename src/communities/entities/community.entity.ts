import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { Club } from '../../clubs/entities/club.entity.js';
import { JoinPolicy } from '../../clubs/enums/club.enum.js';
import { User } from '../../users/entities/user.entity.js';
import { CommunityTier } from '../enums/community.enum.js';
import { CommunityJoinRequest } from './community-join-request.entity.js';
import { CommunityMember } from './community-member.entity.js';

@Entity('communities')
export class Community {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text' })
  rules!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  dpUrl!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  coverUrl!: string | null;

  @Column({ type: 'varchar', length: 32, default: '#4c8dff' })
  color!: string;

  @Column({ type: 'varchar', length: 16 })
  initials!: string;

  @Column({ type: 'int', default: 0 })
  points!: number;

  @Column({ type: 'enum', enum: CommunityTier, default: CommunityTier.NEW })
  tier!: CommunityTier;

  @Column({ type: 'enum', enum: JoinPolicy, default: JoinPolicy.INSTANT })
  joinPolicy!: JoinPolicy;

  @Column({ type: 'varchar', length: 255, nullable: true })
  location!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  motto!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  facebookUrl!: string | null;

  @Column({ type: 'uuid' })
  creatorId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'creatorId' })
  creator?: Relation<User>;

  @ManyToMany(() => Club, (club) => club.communities)
  @JoinTable({
    name: 'community_clubs',
    joinColumn: { name: 'communityId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'clubId', referencedColumnName: 'id' },
  })
  clubs?: Relation<Club[]>;

  @OneToMany(() => CommunityMember, (member) => member.community)
  members?: Relation<CommunityMember[]>;

  @OneToMany(() => CommunityJoinRequest, (req) => req.community)
  joinRequests?: Relation<CommunityJoinRequest[]>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
