import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { EfootballProfile } from '../../users/entities/efootball-profile.entity.js';
import { Club } from './club.entity.js';

@Entity('teams')
export class Team {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @ManyToOne(() => Club, (club) => club.teams, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clubId' })
  club!: Relation<Club>;

  @Column({ type: 'uuid' })
  clubId!: string;

  @ManyToOne(() => EfootballProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'captainProfileId' })
  captain?: Relation<EfootballProfile> | null;

  @Column({ type: 'uuid', nullable: true })
  captainProfileId!: string | null;

  @OneToMany(() => EfootballProfile, (profile) => profile.team)
  members?: Relation<EfootballProfile[]>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
