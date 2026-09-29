import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Match scheduling: organizer play hours, a 3h playing range + evidence
 * deadline per game, how each game was resolved, and time-change requests.
 */
export class AddMatchScheduling1790800000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "playHoursStart" smallint`);
        await queryRunner.query(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "playHoursEnd" smallint`);

        await queryRunner.query(`ALTER TABLE "tournament_match_games" ADD COLUMN IF NOT EXISTS "scheduledStart" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "tournament_match_games" ADD COLUMN IF NOT EXISTS "scheduledEnd" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "tournament_match_games" ADD COLUMN IF NOT EXISTS "systemScheduledStart" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "tournament_match_games" ADD COLUMN IF NOT EXISTS "evidenceDeadline" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "tournament_match_games" ADD COLUMN IF NOT EXISTS "resolution" character varying(24)`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tournament_match_games_deadline" ON "tournament_match_games" ("evidenceDeadline")`);
        await queryRunner.query(`ALTER TABLE "tournament_matches" ADD COLUMN IF NOT EXISTS "doubleForfeit" boolean NOT NULL DEFAULT false`);

        await queryRunner.query(`
            CREATE TABLE "tournament_game_time_requests" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "gameId" uuid NOT NULL,
                "requestedByUserId" uuid NOT NULL,
                "proposedStart" TIMESTAMP WITH TIME ZONE NOT NULL,
                "status" character varying(16) NOT NULL DEFAULT 'pending',
                "respondedAt" TIMESTAMP WITH TIME ZONE,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_tournament_game_time_requests" PRIMARY KEY ("id"),
                CONSTRAINT "FK_tournament_game_time_requests_game" FOREIGN KEY ("gameId") REFERENCES "tournament_match_games"("id") ON DELETE CASCADE
            )`);
        await queryRunner.query(`CREATE INDEX "IDX_tournament_game_time_requests_game_status" ON "tournament_game_time_requests" ("gameId", "status")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "tournament_game_time_requests"`);
        await queryRunner.query(`ALTER TABLE "tournament_matches" DROP COLUMN IF EXISTS "doubleForfeit"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tournament_match_games_deadline"`);
        for (const column of ["resolution", "evidenceDeadline", "systemScheduledStart", "scheduledEnd", "scheduledStart"]) {
            await queryRunner.query(`ALTER TABLE "tournament_match_games" DROP COLUMN IF EXISTS "${column}"`);
        }
        await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "playHoursEnd"`);
        await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "playHoursStart"`);
    }

}
