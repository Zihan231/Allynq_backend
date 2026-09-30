import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Notification times were stored without a time zone. The database fills them
 * in UTC, but the server (Bangladesh time) read them back as local time, so
 * every notification looked 6 hours older than it was. Store them with the
 * zone, reading the existing values as the UTC moments they are.
 */
export class NotificationTimesWithTimeZone1791200000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "notifications"
              ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC',
              ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "notifications"
              ALTER COLUMN "createdAt" TYPE TIMESTAMP USING "createdAt" AT TIME ZONE 'UTC',
              ALTER COLUMN "updatedAt" TYPE TIMESTAMP USING "updatedAt" AT TIME ZONE 'UTC'
        `);
    }
}
