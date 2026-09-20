import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationsAndClubJoinRequests1789400000002 implements MigrationInterface {
  name = 'CreateNotificationsAndClubJoinRequests1789400000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "title" character varying(255) NOT NULL,
        "message" text NOT NULL,
        "type" character varying(64) NOT NULL DEFAULT 'system',
        "link" character varying(512),
        "read" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_notifications_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notifications_userId" ON "notifications" ("userId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notifications_read" ON "notifications" ("read")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notifications_createdAt" ON "notifications" ("createdAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "club_join_requests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "clubId" uuid NOT NULL,
        "requesterUserId" uuid NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'pending',
        "reviewedByUserId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_club_join_requests_club" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_club_join_requests_requester" FOREIGN KEY ("requesterUserId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_club_join_requests_reviewer" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_club_join_requests_clubId" ON "club_join_requests" ("clubId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_club_join_requests_requesterUserId" ON "club_join_requests" ("requesterUserId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_club_join_requests_status" ON "club_join_requests" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "club_join_requests"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
  }
}
