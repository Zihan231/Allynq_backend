import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTournamentsAndParticipants1789400000003 implements MigrationInterface {
  name = 'CreateTournamentsAndParticipants1789400000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "tournament_type_enum" AS ENUM ('pvp', 'cvc');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "tournament_status_enum" AS ENUM ('registration_open', 'submission_phase', 'ongoing', 'completed', 'cancelled');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "tournament_preset_enum" AS ENUM ('11v11', '8v8', 'custom');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "participant_type_enum" AS ENUM ('club', 'player');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "participant_status_enum" AS ENUM ('registered', 'lineup_submitted', 'confirmed', 'disqualified');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tournaments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" character varying(255) NOT NULL,
        "description" text,
        "type" "tournament_type_enum" NOT NULL,
        "status" "tournament_status_enum" NOT NULL DEFAULT 'registration_open',
        "preset" "tournament_preset_enum" NOT NULL DEFAULT '11v11',
        "startersCount" integer NOT NULL DEFAULT 11,
        "subsCount" integer NOT NULL DEFAULT 5,
        "maxParticipants" integer NOT NULL DEFAULT 16,
        "entryFeeBdt" integer NOT NULL DEFAULT 0,
        "prizePoolBdt" integer NOT NULL DEFAULT 0,
        "registrationDeadline" TIMESTAMP WITH TIME ZONE,
        "teamSubmissionDeadline" TIMESTAMP WITH TIME ZONE NOT NULL,
        "startAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "endAt" TIMESTAMP WITH TIME ZONE,
        "bracket" jsonb,
        "communityId" uuid NOT NULL,
        "creatorId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_tournaments_community" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tournaments_creator" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tournaments_communityId" ON "tournaments" ("communityId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tournaments_type" ON "tournaments" ("type")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tournaments_status" ON "tournaments" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tournaments_startAt" ON "tournaments" ("startAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tournament_participants" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tournamentId" uuid NOT NULL,
        "participantType" "participant_type_enum" NOT NULL,
        "clubId" uuid,
        "userId" uuid,
        "registeredByUserId" uuid,
        "status" "participant_status_enum" NOT NULL DEFAULT 'registered',
        "lineup" jsonb,
        "submittedAt" TIMESTAMP WITH TIME ZONE,
        "submittedByUserId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_tournament_participants_tournament" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tournament_participants_club" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tournament_participants_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tournament_participants_registeredBy" FOREIGN KEY ("registeredByUserId") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_tournament_participants_submittedBy" FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tournament_participants_club_unique" ON "tournament_participants" ("tournamentId", "clubId") WHERE "clubId" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tournament_participants_user_unique" ON "tournament_participants" ("tournamentId", "userId") WHERE "userId" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tournament_participants_tournamentId" ON "tournament_participants" ("tournamentId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tournament_participants"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tournaments"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "participant_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "participant_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tournament_preset_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tournament_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tournament_type_enum"`);
  }
}
