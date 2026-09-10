import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { ClubRole, CommunityRole, SquadTeam } from '../enums/user-attributes.enum.js';
import { User } from './user.entity.js';

/**
 * eFootball-specific attributes. clubId/communityId are plain nullable columns
 * (no FK) since Club/Community entities are not part of this module yet.
 */
@Entity('efootball_profiles')
export class EfootballProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @OneToOne(() => User, (user) => user.efootballProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: Relation<User>;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  konamiUid!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  gamePosition!: string | null;

  @Column({ type: 'enum', enum: SquadTeam, nullable: true })
  squadTeam!: SquadTeam | null;

  @Column({ type: 'int', nullable: true })
  shirtNumber!: number | null;

  @Column({ type: 'int', default: 0 })
  points!: number;

  @Column({ type: 'uuid', nullable: true })
  clubId!: string | null;

  @Column({ type: 'enum', enum: ClubRole, nullable: true })
  clubRole!: ClubRole | null;

  @Column({ type: 'uuid', nullable: true })
  communityId!: string | null;

  @Column({ type: 'enum', enum: CommunityRole, nullable: true })
  communityRole!: CommunityRole | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
