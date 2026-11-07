import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SeasonStatus = 'draft' | 'active' | 'closed';

@Entity('seasons')
export class Season {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'datetime', precision: 3 })
  startsAt!: Date;

  @Column({ type: 'datetime', precision: 3 })
  endsAt!: Date;

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status!: SeasonStatus;

  @Column({ type: 'json', default: () => "(JSON_OBJECT())" })
  rules!: Record<string, unknown>;

  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 3 })
  updatedAt!: Date;
}
