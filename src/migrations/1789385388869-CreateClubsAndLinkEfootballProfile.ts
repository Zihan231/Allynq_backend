import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateClubsAndLinkEfootballProfile1789385388869 implements MigrationInterface {
    name = 'CreateClubsAndLinkEfootballProfile1789385388869'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."clubs_joinpolicy_enum" AS ENUM('instant', 'approval')`);
        await queryRunner.query(`CREATE TYPE "public"."clubs_stage_enum" AS ENUM('Apex', 'College', 'District', 'Division', 'Elite', 'Foundation', 'Intra Bid S1', 'Matchday Management Panel', 'N/A', 'Official Team', 'Reality Bid S1', 'Reality Bid S2', 'Special', 'University')`);
        await queryRunner.query(`CREATE TABLE "clubs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "color" character varying(32) NOT NULL, "initials" character varying(16) NOT NULL, "dpUrl" character varying(512), "coverUrl" character varying(512), "description" text, "points" integer NOT NULL DEFAULT '0', "joinPolicy" "public"."clubs_joinpolicy_enum" NOT NULL DEFAULT 'instant', "minRoster" integer NOT NULL DEFAULT '4', "maxRoster" integer NOT NULL DEFAULT '8', "communityIds" jsonb NOT NULL DEFAULT '[]', "stage" "public"."clubs_stage_enum" NOT NULL DEFAULT 'Foundation', "location" character varying(255), "motto" character varying(255), "facebookUrl" character varying(512), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_bb09bd0c8d5238aeaa8f86ee0d4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "efootball_profiles" ADD CONSTRAINT "FK_156147593485f1d8337680eadef" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "efootball_profiles" DROP CONSTRAINT "FK_156147593485f1d8337680eadef"`);
        await queryRunner.query(`DROP TABLE "clubs"`);
        await queryRunner.query(`DROP TYPE "public"."clubs_stage_enum"`);
        await queryRunner.query(`DROP TYPE "public"."clubs_joinpolicy_enum"`);
    }

}
