import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * General tournaments have neither a community nor a club host. Keep rejecting
 * the only invalid combination: selecting both host types at the same time.
 */
export class AllowGeneralTournamentHost1792710000000 implements MigrationInterface {
  name = 'AllowGeneralTournamentHost1792710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tournaments"
        DROP CONSTRAINT "CHK_tournaments_one_host",
        ADD CONSTRAINT "CHK_tournaments_one_host"
          CHECK (NOT ("communityId" IS NOT NULL AND "hostClubId" IS NOT NULL))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tournaments"
        DROP CONSTRAINT "CHK_tournaments_one_host",
        ADD CONSTRAINT "CHK_tournaments_one_host"
          CHECK (("communityId" IS NULL) <> ("hostClubId" IS NULL))
    `);
  }
}
