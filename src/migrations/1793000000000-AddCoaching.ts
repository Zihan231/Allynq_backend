import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roles picked at sign-up ("What suits you best?") and coaching: coach profiles, their
 * posts (shown once staff approve them) and coaching deals with clubs. Coaching fees go
 * through the wallets with a platform cut, kept on a single platform wallet.
 */
export class AddCoaching1793000000000 implements MigrationInterface {
  name = 'AddCoaching1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "roles" jsonb NOT NULL DEFAULT '["player"]'::jsonb`);
    await queryRunner.query(`ALTER TABLE "users" ADD "primaryRole" varchar(16) NOT NULL DEFAULT 'player'`);
    await queryRunner.query(`ALTER TABLE "users" ADD "rolesChosenAt" timestamptz NULL`);

    await queryRunner.query(`
      CREATE TABLE "coach_profiles" (
        "userId" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
        "headline" varchar(120) NOT NULL DEFAULT '',
        "bio" text NULL,
        "youtubeChannelUrl" varchar(500) NULL,
        "specialities" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "askingFeeTk" int NULL,
        "available" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE "coach_posts" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "coachUserId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "body" text NOT NULL DEFAULT '',
        "links" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "media" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "rejectReason" text NULL,
        "reviewedById" uuid NULL,
        "reviewedAt" timestamptz NULL,
        "deletedAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_coach_posts_coach" ON "coach_posts" ("coachUserId", "createdAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_coach_posts_status" ON "coach_posts" ("status", "createdAt")`);

    await queryRunner.query(`
      CREATE TABLE "coaching_deals" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "coachUserId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "clubId" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
        "origin" varchar(8) NOT NULL,
        "turn" varchar(8) NOT NULL,
        "feeTk" int NOT NULL,
        "heldTk" int NOT NULL DEFAULT 0,
        "days" int NOT NULL,
        "commissionPct" int NULL,
        "commissionTk" int NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "message" text NULL,
        "bids" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "createdByUserId" uuid NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "paymentMethod" varchar(16) NULL,
        "paymentRef" varchar(32) NULL,
        "paidAt" timestamptz NULL,
        "startedAt" timestamptz NULL,
        "endsAt" timestamptz NULL,
        "endedAt" timestamptz NULL,
        "endReason" varchar(16) NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_coaching_deals_coach" ON "coaching_deals" ("coachUserId", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_coaching_deals_club" ON "coaching_deals" ("clubId", "status")`);

    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD "coachingDealId" uuid NULL REFERENCES "coaching_deals"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wallet_transactions" DROP COLUMN "coachingDealId"`);
    await queryRunner.query(`DROP TABLE "coaching_deals"`);
    await queryRunner.query(`DROP TABLE "coach_posts"`);
    await queryRunner.query(`DROP TABLE "coach_profiles"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "rolesChosenAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "primaryRole"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "roles"`);
  }
}
