import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from '../../users/entities/user.entity.js';

/** A coach's public card: who he is, his channel, what he asks, and whether clubs can sign him. */
@Entity('coach_profiles')
export class CoachProfile {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: Relation<User>;

  @Column({ type: 'varchar', length: 120, default: '' })
  headline!: string;

  @Column({ type: 'text', nullable: true })
  bio!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  youtubeChannelUrl!: string | null;

  /** e.g. "Attacking play", "Set pieces". */
  @Column({ type: 'json', default: () => "(JSON_ARRAY())" })
  specialities!: string[];

  /** What he usually charges for a coaching deal (a guide; each deal sets its own fee). */
  @Column({ type: 'int', nullable: true })
  askingFeeTk!: number | null;

  /** Listed in the coaches directory for clubs to approach. */
  @Column({ type: 'boolean', default: true })
  available!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 3 })
  updatedAt!: Date;
}
