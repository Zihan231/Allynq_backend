import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Player transfers: adjustable settings, contracts (with a lock and a decaying
 * transfer fee), offers, and demo wallets with a ledger. Current non-leader club
 * members get a contract starting now; pending club join requests are closed,
 * since joining a club now goes through a transfer offer.
 */
export class AddTransfers1791700000000 implements MigrationInterface {
  name = 'AddTransfers1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "app_settings" (
        "key" varchar(64) PRIMARY KEY,
        "value" jsonb NOT NULL,
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      INSERT INTO "app_settings" ("key", "value") VALUES
        ('transfers', '{"baseFeeTk":120,"lockDays":120,"offerExpiryDays":3,"clubStartingBalanceTk":5000,"playerStartingBalanceTk":0,"demoTopUpTk":1000}')`);

    await queryRunner.query(`CREATE SEQUENCE "contract_no_seq" START 1`);

    await queryRunner.query(`
      CREATE TABLE "transfer_offers" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "kind" varchar(24) NOT NULL,
        "playerUserId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "fromClubId" uuid NULL REFERENCES "clubs"("id") ON DELETE SET NULL,
        "toClubId" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
        "amountTk" integer NOT NULL CHECK ("amountTk" >= 0),
        "payeeType" varchar(8) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "message" text NULL,
        "createdByUserId" uuid NOT NULL,
        "respondedByUserId" uuid NULL,
        "expiresAt" timestamptz NOT NULL,
        "playerSignedAt" timestamptz NULL,
        "clubSignedByUserId" uuid NULL,
        "clubSignedAt" timestamptz NULL,
        "paymentMethod" varchar(16) NULL,
        "paymentRef" varchar(32) NULL,
        "paidAt" timestamptz NULL,
        "scheduledTournamentId" uuid NULL,
        "completedAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_transfer_offers_player" ON "transfer_offers" ("playerUserId", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_transfer_offers_to_club" ON "transfer_offers" ("toClubId", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_transfer_offers_from_club" ON "transfer_offers" ("fromClubId", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_transfer_offers_expiry" ON "transfer_offers" ("status", "expiresAt")`);

    await queryRunner.query(`
      CREATE TABLE "player_contracts" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "contractNo" varchar(24) NOT NULL UNIQUE,
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "clubId" uuid NOT NULL REFERENCES "clubs"("id") ON DELETE CASCADE,
        "offerId" uuid NULL REFERENCES "transfer_offers"("id") ON DELETE SET NULL,
        "frozenTk" integer NOT NULL DEFAULT 0,
        "baseTk" integer NOT NULL,
        "lockDays" integer NOT NULL,
        "startAt" timestamptz NOT NULL,
        "lockEndsAt" timestamptz NOT NULL,
        "status" varchar(8) NOT NULL DEFAULT 'active',
        "endedAt" timestamptz NULL,
        "endReason" varchar(16) NULL,
        "notified7dAt" timestamptz NULL,
        "notified1dAt" timestamptz NULL,
        "notifiedFreeAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_player_contracts_active" ON "player_contracts" ("userId") WHERE "status" = 'active'`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_player_contracts_club" ON "player_contracts" ("clubId", "status")`);

    await queryRunner.query(`
      CREATE TABLE "wallets" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "ownerType" varchar(8) NOT NULL,
        "ownerId" uuid NOT NULL,
        "balanceTk" integer NOT NULL DEFAULT 0 CHECK ("balanceTk" >= 0),
        "heldTk" integer NOT NULL DEFAULT 0 CHECK ("heldTk" >= 0),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_wallets_owner" UNIQUE ("ownerType", "ownerId")
      )`);
    await queryRunner.query(`
      CREATE TABLE "wallet_transactions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "walletId" uuid NOT NULL REFERENCES "wallets"("id") ON DELETE CASCADE,
        "amountTk" integer NOT NULL,
        "kind" varchar(16) NOT NULL,
        "offerId" uuid NULL REFERENCES "transfer_offers"("id") ON DELETE SET NULL,
        "counterparty" varchar(255) NULL,
        "reference" varchar(32) NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_wallet_transactions_wallet" ON "wallet_transactions" ("walletId", "createdAt")`);

    // Launch: every current member who isn't the President / GS starts a 120-day contract now.
    await queryRunner.query(`
      INSERT INTO "player_contracts" ("contractNo", "userId", "clubId", "frozenTk", "baseTk", "lockDays", "startAt", "lockEndsAt")
      SELECT 'ALQ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('contract_no_seq')::text, 6, '0'),
             ep."userId", ep."clubId", 0, 120, 120, now(), now() + interval '120 days'
        FROM "efootball_profiles" ep
       WHERE ep."clubId" IS NOT NULL
         AND COALESCE(ep."clubRole", 'Player') NOT IN ('President', 'General Secretary')`);

    // Joining now goes through transfer offers.
    await queryRunner.query(`UPDATE "club_join_requests" SET "status" = 'rejected' WHERE "status" = 'pending'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "wallet_transactions"`);
    await queryRunner.query(`DROP TABLE "wallets"`);
    await queryRunner.query(`DROP TABLE "player_contracts"`);
    await queryRunner.query(`DROP TABLE "transfer_offers"`);
    await queryRunner.query(`DROP SEQUENCE "contract_no_seq"`);
    await queryRunner.query(`DROP TABLE "app_settings"`);
  }
}
