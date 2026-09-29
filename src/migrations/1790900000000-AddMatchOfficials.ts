import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Match officials picked by the organizer: together with the community
 * President and Vice President they review uploaded match evidence.
 */
export class AddMatchOfficials1790900000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "matchOfficialIds" jsonb NOT NULL DEFAULT '[]'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "matchOfficialIds"`);
    }
}
