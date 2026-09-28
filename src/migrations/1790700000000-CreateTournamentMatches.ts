import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Competition engine: fixtures (group stage + knockout), the 1v1 games inside
 * each fixture, and each side's evidence-backed result submissions.
 */
export class CreateTournamentMatches1790700000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "format" character varying(24)`);

        await queryRunner.query(`
            CREATE TABLE "tournament_matches" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "tournamentId" uuid NOT NULL,
                "stage" character varying(16) NOT NULL,
                "groupLabel" character varying(4),
                "round" integer NOT NULL,
                "roundName" character varying(32) NOT NULL,
                "matchNumber" integer NOT NULL,
                "participantAId" uuid,
                "participantBId" uuid,
                "nextMatchId" uuid,
                "nextSlot" character varying(1),
                "status" character varying(24) NOT NULL DEFAULT 'scheduled',
                "scoreA" integer,
                "scoreB" integer,
                "goalsA" integer,
                "goalsB" integer,
                "winnerParticipantId" uuid,
                "completedAt" TIMESTAMP WITH TIME ZONE,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_tournament_matches" PRIMARY KEY ("id"),
                CONSTRAINT "FK_tournament_matches_tournament" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_tournament_matches_participant_a" FOREIGN KEY ("participantAId") REFERENCES "tournament_participants"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_tournament_matches_participant_b" FOREIGN KEY ("participantBId") REFERENCES "tournament_participants"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_tournament_matches_next" FOREIGN KEY ("nextMatchId") REFERENCES "tournament_matches"("id") ON DELETE SET NULL
            )`);
        await queryRunner.query(`CREATE INDEX "IDX_tournament_matches_tournament_stage" ON "tournament_matches" ("tournamentId", "stage")`);

        await queryRunner.query(`
            CREATE TABLE "tournament_match_games" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "matchId" uuid NOT NULL,
                "slot" integer NOT NULL,
                "isDecider" boolean NOT NULL DEFAULT false,
                "playerAProfileId" uuid,
                "playerAUserId" uuid,
                "playerAName" character varying(255) NOT NULL,
                "playerADpUrl" character varying(512),
                "playerBProfileId" uuid,
                "playerBUserId" uuid,
                "playerBName" character varying(255) NOT NULL,
                "playerBDpUrl" character varying(512),
                "goalsA" integer,
                "goalsB" integer,
                "status" character varying(16) NOT NULL DEFAULT 'pending',
                "reviewedByUserId" uuid,
                "reviewedAt" TIMESTAMP WITH TIME ZONE,
                "reviewNote" text,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_tournament_match_games" PRIMARY KEY ("id"),
                CONSTRAINT "FK_tournament_match_games_match" FOREIGN KEY ("matchId") REFERENCES "tournament_matches"("id") ON DELETE CASCADE
            )`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_tournament_match_games_match_slot" ON "tournament_match_games" ("matchId", "slot")`);
        await queryRunner.query(`CREATE INDEX "IDX_tournament_match_games_player_a" ON "tournament_match_games" ("playerAUserId")`);
        await queryRunner.query(`CREATE INDEX "IDX_tournament_match_games_player_b" ON "tournament_match_games" ("playerBUserId")`);

        await queryRunner.query(`
            CREATE TABLE "tournament_game_submissions" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "gameId" uuid NOT NULL,
                "side" character varying(1) NOT NULL,
                "submittedByUserId" uuid NOT NULL,
                "goalsA" integer NOT NULL,
                "goalsB" integer NOT NULL,
                "screenshotPaths" jsonb NOT NULL DEFAULT '[]',
                "videoPath" character varying(512),
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_tournament_game_submissions" PRIMARY KEY ("id"),
                CONSTRAINT "FK_tournament_game_submissions_game" FOREIGN KEY ("gameId") REFERENCES "tournament_match_games"("id") ON DELETE CASCADE
            )`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_tournament_game_submissions_game_side" ON "tournament_game_submissions" ("gameId", "side")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "tournament_game_submissions"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "tournament_match_games"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "tournament_matches"`);
        await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "format"`);
    }

}
