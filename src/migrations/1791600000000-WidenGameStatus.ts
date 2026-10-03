import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Game statuses include 'awaiting_opponent' (17 characters), which didn't fit the
 * varchar(16) column, so a first evidence upload failed. Widens the column, and
 * removes submissions that failed upload left behind: a game still 'pending' never
 * has a submission in normal flow, and those rows point at files already deleted.
 */
export class WidenGameStatus1791600000000 implements MigrationInterface {
  name = 'WidenGameStatus1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tournament_match_games" ALTER COLUMN "status" TYPE varchar(24)`);
    await queryRunner.query(
      `DELETE FROM "tournament_game_submissions" s
        USING "tournament_match_games" g
        WHERE s."gameId" = g.id AND g.status = 'pending'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tournament_match_games" ALTER COLUMN "status" TYPE varchar(16)`);
  }
}
