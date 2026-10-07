import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** A player's or club's final place in a closed season. */
@Entity('season_standings')
export class SeasonStanding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  seasonId!: string;

  @Column({ type: 'varchar', length: 8 })
  kind!: 'player' | 'club';

  @Column({ type: 'int' })
  rank!: number;

  @Column({ type: 'uuid' })
  entityId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** The full ranking line (points, played, wins, goals…) at closing time. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  line!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
