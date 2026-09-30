import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Club-hosted (PvP) tournaments: a tournament is hosted by exactly one of a
 * community or a club. Also records when officials were told a game is ready
 * for review, so that notification goes out once, after the evidence window.
 */
export class AddClubHostedTournaments1791000000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tournaments" ALTER COLUMN "communityId" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "hostClubId" uuid`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tournaments_hostClubId" ON "tournaments" ("hostClubId")`);
        await queryRunner.query(`
            ALTER TABLE "tournaments"
            ADD CONSTRAINT "FK_tournaments_hostClub" FOREIGN KEY ("hostClubId") REFERENCES "clubs"("id") ON DELETE CASCADE
        `);
        await queryRunner.query(`
            ALTER TABLE "tournaments"
            ADD CONSTRAINT "CHK_tournaments_one_host" CHECK (("communityId" IS NULL) <> ("hostClubId" IS NULL))
        `);

        await queryRunner.query(`ALTER TABLE "tournament_match_games" ADD COLUMN IF NOT EXISTS "reviewReadyNotifiedAt" TIMESTAMP WITH TIME ZONE`);
        // Games already waiting in review were announced under the old rule; don't announce them again.
        await queryRunner.query(`UPDATE "tournament_match_games" SET "reviewReadyNotifiedAt" = now() WHERE status = 'submitted'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tournament_match_games" DROP COLUMN IF EXISTS "reviewReadyNotifiedAt"`);
        await queryRunner.query(`DELETE FROM "tournaments" WHERE "hostClubId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "tournaments" DROP CONSTRAINT IF EXISTS "CHK_tournaments_one_host"`);
        await queryRunner.query(`ALTER TABLE "tournaments" DROP CONSTRAINT IF EXISTS "FK_tournaments_hostClub"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tournaments_hostClubId"`);
        await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "hostClubId"`);
        await queryRunner.query(`ALTER TABLE "tournaments" ALTER COLUMN "communityId" SET NOT NULL`);
    }
}
