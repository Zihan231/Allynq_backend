import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A player on loan can't play for the borrowing club in tournaments he was entered in
 * for his parent club when the loan started; those tournaments are kept on the loan.
 */
export class AddLoanCupTied1792900000000 implements MigrationInterface {
  name = 'AddLoanCupTied1792900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "player_loans" ADD "cupTiedTournamentIds" jsonb NOT NULL DEFAULT '[]'::jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "player_loans" DROP COLUMN "cupTiedTournamentIds"`);
  }
}
