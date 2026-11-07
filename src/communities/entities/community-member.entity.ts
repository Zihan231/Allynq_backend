import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { EfootballProfile } from '../../users/entities/efootball-profile.entity.js';
import { CommunityRole } from '../../users/enums/user-attributes.enum.js';
import { Community } from './community.entity.js';

@Entity('community_members')
@Index(['communityId', 'profileId'], { unique: true })
export class CommunityMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Community, (community) => community.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community?: Relation<Community>;

  @Column({ type: 'varchar', length: 36 })
  communityId!: string;

  @ManyToOne(() => EfootballProfile, (profile) => profile.communityMemberships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profileId' })
  profile?: Relation<EfootballProfile>;

  @Column({ type: 'varchar', length: 36 })
  profileId!: string;

  @Column({ type: 'enum', enum: CommunityRole, default: CommunityRole.MEMBER })
  role!: CommunityRole;

  @Column({ type: 'boolean', default: false })
  isDirectMember!: boolean;

  @Column({ type: 'json', default: () => "(JSON_ARRAY())" })
  sourceClubIds!: string[];

  @CreateDateColumn()
  joinedAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
