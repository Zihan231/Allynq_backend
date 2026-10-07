import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reports: any player (or a club / community leader on behalf of their club or community)
 * can report a player, club, community, tournament or match. Staff review them in the
 * report centre and talk to the reporter in a thread. False reports earn strikes.
 */
export class AddReports1791900000000 implements MigrationInterface {
  name = 'AddReports1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "reportStrikes" int NOT NULL DEFAULT 0`);
    await queryRunner.query(`
      CREATE TABLE "reports" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "reporterId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "reportedAs" varchar(16) NOT NULL DEFAULT 'self',
        "reporterClubId" uuid REFERENCES "clubs"("id") ON DELETE SET NULL,
        "reporterCommunityId" uuid REFERENCES "communities"("id") ON DELETE SET NULL,
        "targetType" varchar(16) NOT NULL,
        "targetId" uuid NOT NULL,
        "targetName" varchar(255) NOT NULL,
        "contextClubId" uuid,
        "contextCommunityId" uuid,
        "reason" varchar(32) NOT NULL,
        "details" text NOT NULL,
        "attachments" jsonb NOT NULL DEFAULT '[]',
        "status" varchar(16) NOT NULL DEFAULT 'open',
        "assigneeId" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "resolution" text,
        "resolutionAction" varchar(24),
        "falseReport" boolean NOT NULL DEFAULT false,
        "resolvedById" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "resolvedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_reports_status" ON "reports" ("status", "createdAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_reports_target" ON "reports" ("targetType", "targetId")`);
    await queryRunner.query(`CREATE INDEX "IDX_reports_reporter" ON "reports" ("reporterId", "createdAt")`);
    // One open report per reporter per target.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_reports_open_per_target" ON "reports" ("reporterId", "targetType", "targetId")
        WHERE "status" IN ('open', 'in_review')`,
    );
    await queryRunner.query(`
      CREATE TABLE "report_messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "reportId" uuid NOT NULL REFERENCES "reports"("id") ON DELETE CASCADE,
        "authorId" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "authorName" varchar(255) NOT NULL,
        "fromStaff" boolean NOT NULL DEFAULT false,
        "internal" boolean NOT NULL DEFAULT false,
        "body" text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_report_messages_report" ON "report_messages" ("reportId", "createdAt")`);
    await queryRunner.query(
      `UPDATE "app_settings" SET "value" = "value" || '{"reportDailyLimit":10,"reportStrikeLimit":3}' WHERE "key" = 'admin'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "report_messages"`);
    await queryRunner.query(`DROP TABLE "reports"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "reportStrikes"`);
    await queryRunner.query(`UPDATE "app_settings" SET "value" = "value" - 'reportDailyLimit' - 'reportStrikeLimit' WHERE "key" = 'admin'`);
  }
}
