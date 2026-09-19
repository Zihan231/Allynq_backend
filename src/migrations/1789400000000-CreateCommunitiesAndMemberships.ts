import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCommunitiesAndMemberships1789400000000 implements MigrationInterface {
  name = 'CreateCommunitiesAndMemberships1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."communities_tier_enum" AS ENUM('Featured', 'Verified', 'Regional', 'Open', 'New')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."community_join_requests_targettype_enum" AS ENUM('player', 'club')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."community_join_requests_status_enum" AS ENUM('pending', 'approved', 'rejected')`,
    );

    await queryRunner.query(
      `CREATE TABLE "communities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(255) NOT NULL,
        "rules" text NOT NULL,
        "dpUrl" character varying(512),
        "coverUrl" character varying(512),
        "color" character varying(32) NOT NULL DEFAULT '#4c8dff',
        "initials" character varying(16) NOT NULL,
        "points" integer NOT NULL DEFAULT 0,
        "tier" "public"."communities_tier_enum" NOT NULL DEFAULT 'New',
        "joinPolicy" "public"."clubs_joinpolicy_enum" NOT NULL DEFAULT 'instant',
        "location" character varying(255),
        "motto" character varying(255),
        "facebookUrl" character varying(512),
        "creatorId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_communities_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "communities" ADD CONSTRAINT "FK_communities_creatorId" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "community_clubs" (
        "communityId" uuid NOT NULL,
        "clubId" uuid NOT NULL,
        CONSTRAINT "PK_community_clubs" PRIMARY KEY ("communityId", "clubId")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "community_clubs" ADD CONSTRAINT "FK_community_clubs_communityId" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_clubs" ADD CONSTRAINT "FK_community_clubs_clubId" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    await queryRunner.query(
      `CREATE TABLE "community_members" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "communityId" uuid NOT NULL,
        "profileId" uuid NOT NULL,
        "role" "public"."efootball_profiles_communityrole_enum" NOT NULL DEFAULT 'Member',
        "isDirectMember" boolean NOT NULL DEFAULT false,
        "sourceClubIds" jsonb NOT NULL DEFAULT '[]',
        "joinedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_community_members_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_community_members_community_profile" ON "community_members" ("communityId", "profileId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "community_members" ADD CONSTRAINT "FK_community_members_communityId" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_members" ADD CONSTRAINT "FK_community_members_profileId" FOREIGN KEY ("profileId") REFERENCES "efootball_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "community_join_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "communityId" uuid NOT NULL,
        "requesterUserId" uuid NOT NULL,
        "targetType" "public"."community_join_requests_targettype_enum" NOT NULL,
        "clubId" uuid,
        "status" "public"."community_join_requests_status_enum" NOT NULL DEFAULT 'pending',
        "reviewedByUserId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_community_join_requests_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "community_join_requests" ADD CONSTRAINT "FK_community_join_requests_communityId" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_join_requests" ADD CONSTRAINT "FK_community_join_requests_requesterUserId" FOREIGN KEY ("requesterUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_join_requests" ADD CONSTRAINT "FK_community_join_requests_clubId" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_join_requests" ADD CONSTRAINT "FK_community_join_requests_reviewedByUserId" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "community_join_requests"`);
    await queryRunner.query(`DROP TYPE "public"."community_join_requests_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."community_join_requests_targettype_enum"`);
    await queryRunner.query(`DROP TABLE "community_members"`);
    await queryRunner.query(`DROP TABLE "community_clubs"`);
    await queryRunner.query(`DROP TABLE "communities"`);
    await queryRunner.query(`DROP TYPE "public"."communities_tier_enum"`);
  }
}
