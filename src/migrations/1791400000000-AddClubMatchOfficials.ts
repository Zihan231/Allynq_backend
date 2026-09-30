import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Club match-official nominees: members who, along with the club staff, can be
 * picked as match officials for the club's tournaments.
 */
export class AddClubMatchOfficials1791400000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "clubs" ADD COLUMN IF NOT EXISTS "matchOfficialIds" jsonb NOT NULL DEFAULT '[]'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "clubs" DROP COLUMN IF EXISTS "matchOfficialIds"`);
    }
}
