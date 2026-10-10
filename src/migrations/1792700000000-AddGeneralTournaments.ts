import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * General tournaments (organizer mode): a tournament with no community or club,
 * run by the user who created it. Entry fees are held from each entrant's wallet
 * and paid to the organizer when fixtures are generated; the organizer's prize
 * money is held until the champion is known.
 */
export class AddGeneralTournaments1792700000000 implements MigrationInterface {
  name = 'AddGeneralTournaments1792700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tournament_participants"
        ADD "feeHeldTk" integer NOT NULL DEFAULT 0,
        ADD "feePaidTk" integer NOT NULL DEFAULT 0,
        ADD "paymentMethod" varchar(16) NULL,
        ADD "paymentRef" varchar(32) NULL,
        ADD "paidAt" timestamptz NULL`);
    await queryRunner.query(`ALTER TABLE "tournaments" ADD "prizeHeldTk" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD "tournamentId" uuid NULL REFERENCES "tournaments"("id") ON DELETE SET NULL`,
    );
    // The public list of general tournaments filters on "no host".
    await queryRunner.query(
      `CREATE INDEX "IDX_tournaments_general" ON "tournaments" ("startAt") WHERE "communityId" IS NULL AND "hostClubId" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_tournaments_general"`);
    await queryRunner.query(`ALTER TABLE "wallet_transactions" DROP COLUMN "tournamentId"`);
    await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN "prizeHeldTk"`);
    await queryRunner.query(`
      ALTER TABLE "tournament_participants"
        DROP COLUMN "feeHeldTk", DROP COLUMN "feePaidTk", DROP COLUMN "paymentMethod",
        DROP COLUMN "paymentRef", DROP COLUMN "paidAt"`);
  }
}
