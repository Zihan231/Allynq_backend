import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToOne, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Community } from '../../communities/entities/community.entity.js';
import { Tournament } from '../../tournaments/entities/tournament.entity.js';
import { User } from '../../users/entities/user.entity.js';

/** A sponsor's brand card: shown on their page, in the directory and next to what they sponsor. */
@Entity('sponsor_profiles')
export class SponsorProfile {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  userId!: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: Relation<User>;

  @Column({ type: 'varchar', length: 80, default: '' })
  brandName!: string;

  @Column({ type: 'varchar', length: 140, default: '' })
  tagline!: string;

  @Column({ type: 'text', nullable: true })
  about!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  logoUrl!: string | null;

  /** The banner placed on sponsored tournament and community pages. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  bannerUrl!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  website!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  facebookUrl!: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  industry!: string | null;

  /** Set when staff have verified the brand (badge, listed first). */
  @Column({ type: 'datetime', precision: 6, nullable: true })
  verifiedAt!: Date | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  verifiedById!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt!: Date;
}

export type SponsorTargetType = 'tournament' | 'community';
export type SponsorTier = 'title' | 'gold' | 'partner';
export const SPONSOR_TIERS: SponsorTier[] = ['title', 'gold', 'partner'];
/** How many active sponsors of each tier a tournament or community can have. */
export const TIER_LIMITS: Record<SponsorTier, number> = { title: 1, gold: 3, partner: 8 };
export type SponsorshipParty = 'sponsor' | 'host';
export type SponsorshipStatus = 'pending' | 'active' | 'completed' | 'declined' | 'cancelled' | 'expired' | 'ended';
export type SponsorshipBid = { party: SponsorshipParty; byUserId: string; amountTk: number; tier: SponsorTier; days: number | null; message: string | null; at: string };

/**
 * A sponsorship of a tournament or a community. The sponsor's money is held while the deal
 * is open (from a sponsor's request, or when the sponsor accepts a host's request) and paid
 * to the host minus the platform's cut when it's accepted. A tournament deal lasts until the
 * tournament ends; a community deal lasts `days`.
 */
@Entity('sponsorships')
export class Sponsorship {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  sponsorUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sponsorUserId' })
  sponsor?: Relation<User>;

  @Column({ type: 'varchar', length: 16 })
  targetType!: SponsorTargetType;

  @Column({ type: 'varchar', length: 36, nullable: true })
  tournamentId!: string | null;

  @ManyToOne(() => Tournament, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'tournamentId' })
  tournament?: Relation<Tournament> | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  communityId!: string | null;

  @ManyToOne(() => Community, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'communityId' })
  community?: Relation<Community> | null;

  @Column({ type: 'varchar', length: 16 })
  tier!: SponsorTier;

  @Column({ type: 'int', default: 0 })
  amountTk!: number;

  /** Held from the sponsor's wallet while the deal is open. */
  @Column({ type: 'int', default: 0 })
  heldTk!: number;

  @Column({ type: 'int', default: 0 })
  commissionPct!: number;

  @Column({ type: 'int', default: 0 })
  commissionTk!: number;

  /** Community deals only: how long it runs. */
  @Column({ type: 'int', nullable: true })
  days!: number | null;

  @Column({ type: 'varchar', length: 16 })
  origin!: SponsorshipParty;

  /** Whose answer the deal is waiting for. */
  @Column({ type: 'varchar', length: 16 })
  turn!: SponsorshipParty;

  @Column({ type: 'json', default: () => "(JSON_ARRAY())" })
  bids!: SponsorshipBid[];

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: SponsorshipStatus;

  @Column({ type: 'datetime', precision: 6 })
  expiresAt!: Date;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  endsAt!: Date | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  endedAt!: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  endReason!: 'time' | 'tournament' | 'sponsor' | 'host' | 'staff' | null;

  @Column({ type: 'varchar', length: 36 })
  createdByUserId!: string;

  /** Who received the money (the organizer or the community President). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  paidToUserId!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  paymentRef!: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  paidAt!: Date | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt!: Date;
}

/** "Looking for sponsors": a tournament or community asks sponsors to apply. */
@Entity('sponsor_calls')
export class SponsorCall {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  targetType!: SponsorTargetType;

  @Column({ type: 'varchar', length: 36, nullable: true })
  tournamentId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  communityId!: string | null;

  /** The tiers it's looking for. */
  @Column({ type: 'json', default: () => "(JSON_ARRAY())" })
  tiers!: SponsorTier[];

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  /** What it hopes to get (a guide; each deal sets its own amount). */
  @Column({ type: 'int', nullable: true })
  askTk!: number | null;

  @Column({ type: 'boolean', default: true })
  open!: boolean;

  @Column({ type: 'varchar', length: 36 })
  createdByUserId!: string;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt!: Date;
}

/** Daily views and clicks of a sponsor's logo and banner on a sponsored page. */
@Entity('sponsor_impressions')
export class SponsorImpression {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  sponsorshipId!: string;

  @PrimaryColumn({ type: 'date' })
  day!: string;

  @Column({ type: 'int', default: 0 })
  views!: number;

  @Column({ type: 'int', default: 0 })
  clicks!: number;
}
