import { MigrationInterface, QueryRunner } from 'typeorm';

/** Club tournaments are friendlies: clear any entry fee or prize pool they were created with. */
export class ClubTournamentsFriendly1791500000000 implements MigrationInterface {
  name = 'ClubTournamentsFriendly1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "tournaments" SET "entryFeeBdt" = 0, "prizePoolBdt" = 0
        WHERE "hostClubId" IS NOT NULL AND ("entryFeeBdt" <> 0 OR "prizePoolBdt" <> 0)`,
    );
  }

  public async down(): Promise<void> {
    // The previous amounts aren't kept; nothing to restore.
  }
}
