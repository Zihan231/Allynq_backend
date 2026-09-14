import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAuthAndTeamsSchema1789388666933 implements MigrationInterface {
    name = 'AddAuthAndTeamsSchema1789388666933'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "teams" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "clubId" uuid NOT NULL, "captainProfileId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7e5523774a38b08a6236d322403" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "users" ADD "email" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email")`);
        await queryRunner.query(`ALTER TABLE "users" ADD "password" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "efootball_profiles" ADD "teamId" uuid`);
        await queryRunner.query(`CREATE TYPE "public"."efootball_profiles_lineupstatus_enum" AS ENUM('Starter', 'Sub', 'None')`);
        await queryRunner.query(`ALTER TABLE "efootball_profiles" ADD "lineupStatus" "public"."efootball_profiles_lineupstatus_enum" NOT NULL DEFAULT 'None'`);
        await queryRunner.query(`ALTER TABLE "teams" ADD CONSTRAINT "FK_4e431faf7a3df017d882caac13e" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "teams" ADD CONSTRAINT "FK_8b605fa27d2cdd0192f6cb572ec" FOREIGN KEY ("captainProfileId") REFERENCES "efootball_profiles"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "efootball_profiles" ADD CONSTRAINT "FK_09c5474ff5bcc0006fdcf7b4ca2" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "efootball_profiles" DROP CONSTRAINT "FK_09c5474ff5bcc0006fdcf7b4ca2"`);
        await queryRunner.query(`ALTER TABLE "teams" DROP CONSTRAINT "FK_8b605fa27d2cdd0192f6cb572ec"`);
        await queryRunner.query(`ALTER TABLE "teams" DROP CONSTRAINT "FK_4e431faf7a3df017d882caac13e"`);
        await queryRunner.query(`ALTER TABLE "efootball_profiles" DROP COLUMN "lineupStatus"`);
        await queryRunner.query(`DROP TYPE "public"."efootball_profiles_lineupstatus_enum"`);
        await queryRunner.query(`ALTER TABLE "efootball_profiles" DROP COLUMN "teamId"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "password"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email"`);
        await queryRunner.query(`DROP TABLE "teams"`);
    }

}
