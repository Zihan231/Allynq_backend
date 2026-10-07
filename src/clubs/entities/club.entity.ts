import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  ManyToMany,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { Community } from '../../communities/entities/community.entity.js';
import { EfootballProfile } from '../../users/entities/efootball-profile.entity.js';
import { ClubStage, JoinPolicy } from '../enums/club.enum.js';
import { Team } from './team.entity.js';

@Entity('clubs')
export class Club {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 32 })
  color!: string;

  @Column({ type: 'varchar', length: 16 })
  initials!: string;

  @Column({ type: 'text', nullable: true })
  dpUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  coverUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'int', default: 0 })
  points!: number;

  @Column({ type: 'enum', enum: JoinPolicy, default: JoinPolicy.INSTANT })
  joinPolicy!: JoinPolicy;

  @Column({ type: 'int', default: 4 })
  minRoster!: number;

  @Column({ type: 'int', default: 8 })
  maxRoster!: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  communityIds!: string[];

  /**
   * User ids of members nominated as match officials: together with the club
   * staff they can be picked to review evidence in the club's tournaments.
   */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  matchOfficialIds!: string[];

  @Column({ type: 'enum', enum: ClubStage, default: ClubStage.FOUNDATION })
  stage!: ClubStage;

  @Column({ type: 'varchar', length: 255, nullable: true })
  location!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  motto!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  facebookUrl!: string | null;

  @OneToMany(() => EfootballProfile, (profile) => profile.club)
  members?: Relation<EfootballProfile[]>;

  @OneToMany(() => Team, (team) => team.club)
  teams?: Relation<Team[]>;

  @ManyToMany(() => Community, (community) => community.clubs)
  communities?: Relation<Community[]>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /** Set while it sits in the recycle bin: hidden everywhere, restorable until purged. */
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  /** Set while ALLYNQ staff have frozen it: visible, but its activity is paused. */
  @Column({ type: 'timestamptz', nullable: true })
  frozenAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  frozenReason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  frozenById!: string | null;
}
