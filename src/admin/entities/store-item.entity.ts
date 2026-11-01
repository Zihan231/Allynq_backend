import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Player cosmetics (owned and equipped by a user). */
export type PlayerItemCategory = 'badge' | 'title' | 'frame' | 'theme';
/** Everything the store sells: player cosmetics, club themes, tournament banners and sticker packs. */
export type StoreItemCategory = PlayerItemCategory | 'club_theme' | 'tournament_banner' | 'sticker_pack';
export const PLAYER_CATEGORIES: PlayerItemCategory[] = ['badge', 'title', 'frame', 'theme'];

/**
 * Review state of a creator's design (staff items are always approved). Pausing sales is
 * `active = false`; a change to an approved design waits in `pendingAssets`.
 */
export type DesignStatus = 'pending' | 'approved' | 'rejected';
/** Who an item is for: a player, a club (bought by its leaders) or a tournament (by its organizer). */
export type StoreItemTarget = 'player' | 'club' | 'tournament';

/** A creator design's files and colours (uploaded images are served from /uploads/creators). */
/** An earlier approved look of a creator's design. */
export interface DesignVersion {
  version: number;
  assets: DesignAssets;
  approvedAt: string | null;
}

export interface DesignAssets {
  imageUrl?: string;
  bannerUrl?: string;
  frameUrl?: string;
  colors?: { primary: string; secondary: string };
  stickers?: string[];
}

@Entity('store_items')
export class StoreItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  sku!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 24 })
  category!: StoreItemCategory;

  @Column({ type: 'int' })
  priceTk!: number;

  @Column({ type: 'text', nullable: true })
  assetUrl!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  /** The creator who designed it (null for ALLYNQ's own items). */
  @Column({ type: 'uuid', nullable: true })
  creatorUserId!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'approved' })
  reviewStatus!: DesignStatus;

  @Column({ type: 'varchar', length: 16, default: 'player' })
  target!: StoreItemTarget;

  /** The approved design (creator items). */
  @Column({ type: 'jsonb', nullable: true })
  assets!: DesignAssets | null;

  /** A design change waiting for review; the approved one keeps selling meanwhile. */
  @Column({ type: 'jsonb', nullable: true })
  pendingAssets!: DesignAssets | null;

  /** The approved look's number (1 = first). Each approved change adds one. */
  @Column({ type: 'int', default: 1 })
  version!: number;

  /** Earlier approved looks, kept so owners can stay on the one they had. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  versions!: DesignVersion[];

  @Column({ type: 'text', nullable: true })
  rejectReason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedById!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  salesCount!: number;

  /** What buyers paid in all (before the platform's cut). */
  @Column({ type: 'int', default: 0 })
  revenueTk!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
