import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type BinEntityType = 'user' | 'club' | 'community' | 'tournament';
export const BIN_ENTITY_TYPES: BinEntityType[] = ['user', 'club', 'community', 'tournament'];

export interface BinMember {
  profileId: string;
  userId: string;
  role: string | null;
  teamId?: string | null;
}

/** Links cut when the item went to the bin, so restoring can put them back. */
export interface BinSnapshot {
  members?: BinMember[];
}

/** Something deleted by a leader or an admin, kept until `purgeAfter` so it can be restored. */
@Entity('recycle_bin')
export class RecycleBinItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  entityType!: BinEntityType;

  @Column({ type: 'uuid' })
  entityId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'uuid', nullable: true })
  deletedById!: string | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  snapshot!: BinSnapshot | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  deletedAt!: Date;

  @Column({ type: 'timestamptz' })
  purgeAfter!: Date;
}
