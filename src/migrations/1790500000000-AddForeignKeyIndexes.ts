import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Indexes for foreign-key columns that club/community/team queries filter on.
 * Postgres does not index FK columns automatically.
 */
export class AddForeignKeyIndexes1790500000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_efootball_profiles_clubId" ON "efootball_profiles" ("clubId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_efootball_profiles_teamId" ON "efootball_profiles" ("teamId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_efootball_profiles_communityId" ON "efootball_profiles" ("communityId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_community_members_profileId" ON "community_members" ("profileId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_community_clubs_clubId" ON "community_clubs" ("clubId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_teams_clubId" ON "teams" ("clubId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_community_join_requests_communityId_status" ON "community_join_requests" ("communityId", "status")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_community_join_requests_requesterUserId" ON "community_join_requests" ("requesterUserId")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_community_join_requests_requesterUserId"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_community_join_requests_communityId_status"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_teams_clubId"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_community_clubs_clubId"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_community_members_profileId"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_efootball_profiles_communityId"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_efootball_profiles_teamId"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_efootball_profiles_clubId"`);
    }

}
