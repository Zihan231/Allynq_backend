import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Staff announcements (sent now or scheduled), and the platform switches staff control:
 * feature flags (sign-ups, transfer market, reports) and maintenance mode.
 */
export class AddAnnouncementsAndFlags1792100000000 implements MigrationInterface {
  name = 'AddAnnouncementsAndFlags1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "announcements" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "title" varchar(120) NOT NULL,
        "message" text NOT NULL,
        "link" varchar(255),
        "audience" jsonb NOT NULL,
        "audienceLabel" varchar(255) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'scheduled',
        "scheduledFor" timestamptz,
        "sentAt" timestamptz,
        "recipients" int NOT NULL DEFAULT 0,
        "createdById" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_announcements_due" ON "announcements" ("status", "scheduledFor")`);
    await queryRunner.query(`
      INSERT INTO "app_settings" ("key", "value") VALUES
        ('features', '{"signupsOpen":true,"transfersOpen":true,"reportsOpen":true}'),
        ('maintenance', '{"enabled":false,"message":""}')
      ON CONFLICT ("key") DO NOTHING`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "app_settings" WHERE "key" IN ('features', 'maintenance')`);
    await queryRunner.query(`DROP TABLE "announcements"`);
  }
}
