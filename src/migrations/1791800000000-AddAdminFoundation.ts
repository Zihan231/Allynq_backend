import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Super admin foundation:
 * - staff roles, suspensions, bans, force-logout and ID-document review state on users;
 * - soft delete (recycle bin) for users, clubs, communities and tournaments;
 * - the admin audit log, the user activity log and login history.
 *
 * Users already holding a document are put in the review queue; their current level is kept
 * until a moderator decides (it used to be self-assigned from the document type).
 */
export class AddAdminFoundation1791800000000 implements MigrationInterface {
  name = 'AddAdminFoundation1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "system_role_enum" AS ENUM ('moderator', 'admin', 'super_admin')`);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD "verificationStatus" varchar(16) NOT NULL DEFAULT 'none',
        ADD "verificationNote" text,
        ADD "verificationReviewedAt" timestamptz,
        ADD "verificationReviewedById" uuid,
        ADD "systemRole" "system_role_enum",
        ADD "suspendedUntil" timestamptz,
        ADD "suspendReason" text,
        ADD "bannedAt" timestamptz,
        ADD "banReason" text,
        ADD "warningsCount" int NOT NULL DEFAULT 0,
        ADD "tokenVersion" int NOT NULL DEFAULT 0,
        ADD "deletedAt" timestamptz,
        ADD "lastLoginAt" timestamptz`);
    await queryRunner.query(
      `UPDATE "users" SET "verificationStatus" = 'pending' WHERE "documentDataUrl" IS NOT NULL AND "documentDataUrl" <> ''`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_users_systemRole" ON "users" ("systemRole") WHERE "systemRole" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_users_verificationStatus" ON "users" ("verificationStatus")`);
    await queryRunner.query(`CREATE INDEX "IDX_users_createdAt" ON "users" ("createdAt")`);

    for (const table of ['clubs', 'communities', 'tournaments']) {
      await queryRunner.query(`ALTER TABLE "${table}" ADD "deletedAt" timestamptz`);
    }

    await queryRunner.query(`
      CREATE TABLE "recycle_bin" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "entityType" varchar(16) NOT NULL,
        "entityId" uuid NOT NULL,
        "name" varchar(255) NOT NULL,
        "deletedById" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "reason" text,
        "snapshot" jsonb,
        "deletedAt" timestamptz NOT NULL DEFAULT now(),
        "purgeAfter" timestamptz NOT NULL
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_recycle_bin_entity" ON "recycle_bin" ("entityType", "entityId")`);
    await queryRunner.query(`CREATE INDEX "IDX_recycle_bin_purgeAfter" ON "recycle_bin" ("purgeAfter")`);

    await queryRunner.query(`
      CREATE TABLE "admin_audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "actorId" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "actorName" varchar(255) NOT NULL,
        "actorRole" varchar(16) NOT NULL,
        "action" varchar(48) NOT NULL,
        "targetType" varchar(24) NOT NULL,
        "targetId" uuid,
        "targetName" varchar(255),
        "before" jsonb,
        "after" jsonb,
        "reason" text,
        "ip" varchar(64),
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_createdAt" ON "admin_audit_logs" ("createdAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_target" ON "admin_audit_logs" ("targetType", "targetId")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_actor" ON "admin_audit_logs" ("actorId")`);

    await queryRunner.query(`
      CREATE TABLE "activity_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid REFERENCES "users"("id") ON DELETE CASCADE,
        "type" varchar(48) NOT NULL,
        "targetType" varchar(24),
        "targetId" uuid,
        "summary" text NOT NULL,
        "meta" jsonb,
        "ip" varchar(64),
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_activity_user" ON "activity_events" ("userId", "createdAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_activity_createdAt" ON "activity_events" ("createdAt")`);

    await queryRunner.query(`
      CREATE TABLE "login_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid REFERENCES "users"("id") ON DELETE CASCADE,
        "email" varchar(255) NOT NULL,
        "success" boolean NOT NULL,
        "failureReason" varchar(32),
        "ip" varchar(64),
        "userAgent" text,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_login_user" ON "login_events" ("userId", "createdAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_login_createdAt" ON "login_events" ("createdAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_login_ip" ON "login_events" ("ip")`);

    await queryRunner.query(
      `INSERT INTO "app_settings" ("key", "value") VALUES ('admin', '{"binRetentionDays":30,"moderatorMaxSuspendDays":7}')
       ON CONFLICT ("key") DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "app_settings" WHERE "key" = 'admin'`);
    await queryRunner.query(`DROP TABLE "login_events"`);
    await queryRunner.query(`DROP TABLE "activity_events"`);
    await queryRunner.query(`DROP TABLE "admin_audit_logs"`);
    await queryRunner.query(`DROP TABLE "recycle_bin"`);
    for (const table of ['clubs', 'communities', 'tournaments']) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "deletedAt"`);
    }
    await queryRunner.query(`DROP INDEX "IDX_users_createdAt"`);
    await queryRunner.query(`DROP INDEX "IDX_users_verificationStatus"`);
    await queryRunner.query(`DROP INDEX "IDX_users_systemRole"`);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "verificationStatus", DROP COLUMN "verificationNote", DROP COLUMN "verificationReviewedAt",
        DROP COLUMN "verificationReviewedById", DROP COLUMN "systemRole", DROP COLUMN "suspendedUntil",
        DROP COLUMN "suspendReason", DROP COLUMN "bannedAt", DROP COLUMN "banReason", DROP COLUMN "warningsCount",
        DROP COLUMN "tokenVersion", DROP COLUMN "deletedAt", DROP COLUMN "lastLoginAt"`);
    await queryRunner.query(`DROP TYPE "system_role_enum"`);
  }
}
