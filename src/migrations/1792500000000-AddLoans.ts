import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Player loans: a club lends a player to another club for a number of matches
 * (or at most a number of days); the borrowing club pays a negotiable fee. One open
 * loan per player at a time; every bid of the negotiation is kept.
 */
export class AddLoans1792500000000 implements MigrationInterface {
  name = 'AddLoans1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "player_loans" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "playerUserId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "parentClubId" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
        "borrowClubId" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
        "contractId" uuid NULL REFERENCES "player_contracts"("id") ON DELETE SET NULL,
        "feeTk" integer NOT NULL,
        "heldTk" integer NOT NULL DEFAULT 0,
        "matches" integer NOT NULL,
        "maxDays" integer NOT NULL,
        "matchesPlayed" integer NOT NULL DEFAULT 0,
        "turn" varchar(8) NOT NULL CONSTRAINT "player_loans_turn_check" CHECK ("turn" IN ('parent', 'borrower')),
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "endReason" varchar(16) NULL,
        "message" text NULL,
        "createdByUserId" uuid NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "paymentMethod" varchar(16) NULL,
        "paymentRef" varchar(32) NULL,
        "paidAt" timestamptz NULL,
        "scheduledTournamentId" uuid NULL,
        "startedAt" timestamptz NULL,
        "endsBy" timestamptz NULL,
        "endedAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_player_loans_open" ON "player_loans" ("playerUserId")
        WHERE "status" IN ('pending', 'scheduled', 'active', 'returning')`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_player_loans_parent" ON "player_loans" ("parentClubId", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_player_loans_borrow" ON "player_loans" ("borrowClubId", "status")`);

    await queryRunner.query(`
      CREATE TABLE "player_loan_bids" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "loanId" uuid NOT NULL REFERENCES "player_loans"("id") ON DELETE CASCADE,
        "party" varchar(8) NOT NULL CONSTRAINT "player_loan_bids_party_check" CHECK ("party" IN ('parent', 'borrower')),
        "byUserId" uuid NOT NULL,
        "feeTk" integer NOT NULL,
        "message" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_player_loan_bids_loan" ON "player_loan_bids" ("loanId", "createdAt")`);

    // Loan fees in the wallet ledger.
    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD "loanId" uuid NULL REFERENCES "player_loans"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wallet_transactions" DROP COLUMN "loanId"`);
    await queryRunner.query(`DROP TABLE "player_loan_bids"`);
    await queryRunner.query(`DROP TABLE "player_loans"`);
  }
}
