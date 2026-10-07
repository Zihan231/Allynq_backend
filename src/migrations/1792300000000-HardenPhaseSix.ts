import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Follow-up to Phase 6:
 * - staff two-step sign-in locks for a while after too many wrong codes;
 * - staff-edited notification text gets a Bangla version;
 * - closing a season keeps its final player and club standings.
 */
export class HardenPhaseSix1792300000000 implements MigrationInterface {
  name = 'HardenPhaseSix1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN "twoFactorFailedAttempts" integer NOT NULL DEFAULT 0,
        ADD COLUMN "twoFactorLockedUntil" timestamptz`);
    await queryRunner.query(`
      ALTER TABLE notification_templates
        ADD COLUMN "titleTemplateBn" varchar(255),
        ADD COLUMN "messageTemplateBn" text`);
    await queryRunner.query(`
      CREATE TABLE season_standings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "seasonId" uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
        kind varchar(8) NOT NULL CONSTRAINT season_standings_kind_check CHECK (kind IN ('player', 'club')),
        rank integer NOT NULL,
        "entityId" uuid NOT NULL,
        name varchar(255) NOT NULL,
        line jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT season_standings_uq UNIQUE ("seasonId", kind, "entityId")
      )`);
    await queryRunner.query(`CREATE INDEX season_standings_rank_idx ON season_standings ("seasonId", kind, rank)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE season_standings`);
    await queryRunner.query(`ALTER TABLE notification_templates DROP COLUMN "titleTemplateBn", DROP COLUMN "messageTemplateBn"`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN "twoFactorFailedAttempts", DROP COLUMN "twoFactorLockedUntil"`);
  }
}
