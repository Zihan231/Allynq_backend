import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTeamFormation1790424160110 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "teams" ADD "formation" character varying(50) NOT NULL DEFAULT '4-3-3'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "teams" DROP COLUMN "formation"`);
    }

}
