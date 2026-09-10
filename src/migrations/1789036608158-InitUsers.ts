import { MigrationInterface, QueryRunner } from "typeorm";

export class InitUsers1789036608158 implements MigrationInterface {
    name = 'InitUsers1789036608158'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TYPE "public"."users_bloodgroup_enum" AS ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')`);
        await queryRunner.query(`CREATE TYPE "public"."users_documenttype_enum" AS ENUM('national_id', 'passport', 'birth_certificate', 'driver_license', 'university_docs', 'college_docs')`);
        await queryRunner.query(`CREATE TYPE "public"."users_verificationlevel_enum" AS ENUM('0', '1', '2', '3')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "dpUrl" character varying(512), "coverUrl" character varying(512), "bio" text, "facebookUrl" character varying(512), "facebookProfileName" character varying(255), "instagramUrl" character varying(512), "discordUrl" character varying(512), "inGameId" character varying(255), "deviceName" character varying(255), "deviceModel" character varying(255), "phoneNumber" character varying(32), "birthday" date, "bloodGroup" "public"."users_bloodgroup_enum", "country" character varying(128), "division" character varying(128), "district" character varying(128), "permanentAddress" text, "currentLocation" jsonb, "workExperience" jsonb, "education" jsonb, "documentType" "public"."users_documenttype_enum", "documentDataUrl" text, "verificationLevel" "public"."users_verificationlevel_enum" NOT NULL DEFAULT '0', "ownedCosmeticIds" jsonb, "equippedBadgeId" character varying(128), "equippedTitleId" character varying(128), "equippedFrameId" character varying(128), "equippedThemeId" character varying(128), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."efootball_profiles_squadteam_enum" AS ENUM('Main', 'Academy', 'Legend')`);
        await queryRunner.query(`CREATE TYPE "public"."efootball_profiles_clubrole_enum" AS ENUM('President', 'General Secretary', 'Captain', 'Vice-Captain', 'Academy Captain', 'Manager', 'Player')`);
        await queryRunner.query(`CREATE TYPE "public"."efootball_profiles_communityrole_enum" AS ENUM('President', 'Vice President', 'Team Manager', 'Head of Discipline', 'Scout', 'Member')`);
        await queryRunner.query(`CREATE TABLE "efootball_profiles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "konamiUid" character varying(64), "gamePosition" character varying(32), "squadTeam" "public"."efootball_profiles_squadteam_enum", "shirtNumber" integer, "points" integer NOT NULL DEFAULT '0', "clubId" uuid, "clubRole" "public"."efootball_profiles_clubrole_enum", "communityId" uuid, "communityRole" "public"."efootball_profiles_communityrole_enum", "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "REL_2367262071d5996982cb89143c" UNIQUE ("userId"), CONSTRAINT "PK_39c449f2d635ed36590b0127052" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "efootball_profiles" ADD CONSTRAINT "FK_2367262071d5996982cb89143ce" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "efootball_profiles" DROP CONSTRAINT "FK_2367262071d5996982cb89143ce"`);
        await queryRunner.query(`DROP TABLE "efootball_profiles"`);
        await queryRunner.query(`DROP TYPE "public"."efootball_profiles_communityrole_enum"`);
        await queryRunner.query(`DROP TYPE "public"."efootball_profiles_clubrole_enum"`);
        await queryRunner.query(`DROP TYPE "public"."efootball_profiles_squadteam_enum"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_verificationlevel_enum"`);
        await queryRunner.query(`DROP TYPE "public"."users_documenttype_enum"`);
        await queryRunner.query(`DROP TYPE "public"."users_bloodgroup_enum"`);
    }

}
