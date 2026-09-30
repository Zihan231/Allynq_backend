import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Notifications carry a message code + params so the app can show them in the
 * viewer's language; the saved English title / message remain as a fallback.
 */
export class AddNotificationCodes1791300000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "code" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "params" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN IF EXISTS "params"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN IF EXISTS "code"`);
    }
}
