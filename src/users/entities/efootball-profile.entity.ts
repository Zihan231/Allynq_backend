import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { Club } from '../../clubs/entities/club.entity.js';
import { Team } from '../../clubs/entities/team.entity.js';
import {
  ClubRole,
  CommunityRole,
  LineupStatus,
  SquadTeam,
} from '../enums/user-attributes.enum.js';
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

  @ManyToOne(() => Club, (club) => club.members, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'clubId' })
  club?: Relation<Club> | null;

  @Column({ type: 'uuid', nullable: true })
  clubId!: string | null;

  @ManyToOne(() => Team, (team) => team.members, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'teamId' })
  team?: Relation<Team> | null;

  @Column({ type: 'uuid', nullable: true })
  teamId!: string | null;

  @Column({ type: 'enum', enum: LineupStatus, default: LineupStatus.NONE })
  lineupStatus!: LineupStatus;

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
