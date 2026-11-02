import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sponsor mode: sponsor profiles, sponsorship deals with communities and tournaments (paid
 * through the wallet, minus the platform's cut), open calls for sponsors, view / click
 * stats, and sponsor posts in the feed (coach_posts gets the author's role).
 */
export class AddSponsors1793500000000 implements MigrationInterface {
  name = 'AddSponsors1793500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "sponsor_profiles" (
        "userId" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
        "brandName" varchar(80) NOT NULL DEFAULT '',
        "tagline" varchar(140) NOT NULL DEFAULT '',
        "about" text NULL,
        "logoUrl" varchar(500) NULL,
        "bannerUrl" varchar(500) NULL,
        "website" varchar(500) NULL,
        "facebookUrl" varchar(500) NULL,
        "industry" varchar(60) NULL,
        "verifiedAt" timestamptz NULL,
        "verifiedById" uuid NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE "sponsorships" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "sponsorUserId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "targetType" varchar(16) NOT NULL,
        "tournamentId" uuid NULL REFERENCES "tournaments"("id") ON DELETE CASCADE,
        "communityId" uuid NULL REFERENCES "communities"("id") ON DELETE CASCADE,
        "tier" varchar(16) NOT NULL,
        "amountTk" int NOT NULL DEFAULT 0,
        "heldTk" int NOT NULL DEFAULT 0,
        "commissionPct" int NOT NULL DEFAULT 0,
        "commissionTk" int NOT NULL DEFAULT 0,
        "days" int NULL,
        "origin" varchar(16) NOT NULL,
        "turn" varchar(16) NOT NULL,
        "bids" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "message" text NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "expiresAt" timestamptz NOT NULL,
        "startedAt" timestamptz NULL,
        "endsAt" timestamptz NULL,
        "endedAt" timestamptz NULL,
        "endReason" varchar(16) NULL,
        "createdByUserId" uuid NOT NULL,
        "paidToUserId" uuid NULL,
        "paymentRef" varchar(32) NULL,
        "paidAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_sponsorships_sponsor" ON "sponsorships" ("sponsorUserId", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_sponsorships_tournament" ON "sponsorships" ("tournamentId", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_sponsorships_community" ON "sponsorships" ("communityId", "status")`);

    await queryRunner.query(`
      CREATE TABLE "sponsor_calls" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "targetType" varchar(16) NOT NULL,
        "tournamentId" uuid NULL REFERENCES "tournaments"("id") ON DELETE CASCADE,
        "communityId" uuid NULL REFERENCES "communities"("id") ON DELETE CASCADE,
        "tiers" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "note" text NULL,
        "askTk" int NULL,
        "open" boolean NOT NULL DEFAULT true,
        "createdByUserId" uuid NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_sponsor_calls_open" ON "sponsor_calls" ("open")`);

    await queryRunner.query(`
      CREATE TABLE "sponsor_impressions" (
        "sponsorshipId" uuid NOT NULL REFERENCES "sponsorships"("id") ON DELETE CASCADE,
        "day" date NOT NULL,
        "views" int NOT NULL DEFAULT 0,
        "clicks" int NOT NULL DEFAULT 0,
        PRIMARY KEY ("sponsorshipId", "day")
      )`);

    await queryRunner.query(`ALTER TABLE "coach_posts" ADD "authorRole" varchar(16) NOT NULL DEFAULT 'coach'`);
    await queryRunner.query(`CREATE INDEX "IDX_coach_posts_author_role" ON "coach_posts" ("authorRole", "status")`);
    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD "sponsorshipId" uuid NULL REFERENCES "sponsorships"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wallet_transactions" DROP COLUMN "sponsorshipId"`);
    await queryRunner.query(`DROP INDEX "IDX_coach_posts_author_role"`);
    await queryRunner.query(`ALTER TABLE "coach_posts" DROP COLUMN "authorRole"`);
    await queryRunner.query(`DROP TABLE "sponsor_impressions"`);
    await queryRunner.query(`DROP TABLE "sponsor_calls"`);
    await queryRunner.query(`DROP TABLE "sponsorships"`);
    await queryRunner.query(`DROP TABLE "sponsor_profiles"`);
  }
}
