import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Transfer negotiation:
 * - offers can be countered back and forth; every bid is kept in transfer_offer_bids
 *   and transfer_offers."turn" says who answers next;
 * - transfer_offers."heldTk" is the club money held for the deal right now;
 * - every non-leader club member is under contract: members without one (e.g. a former
 *   President / GS) get a 0 tk contract whose lock starts now.
 */
export class TransferNegotiation1792400000000 implements MigrationInterface {
  name = 'TransferNegotiation1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "transfer_offer_bids" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "offerId" uuid NOT NULL REFERENCES "transfer_offers"("id") ON DELETE CASCADE,
        "party" varchar(8) NOT NULL CONSTRAINT "transfer_offer_bids_party_check" CHECK ("party" IN ('player', 'club')),
        "byUserId" uuid NOT NULL,
        "amountTk" integer NOT NULL,
        "message" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_transfer_offer_bids_offer" ON "transfer_offer_bids" ("offerId", "createdAt")`);

    await queryRunner.query(`ALTER TABLE "transfer_offers" ADD "turn" varchar(8)`);
    await queryRunner.query(
      `UPDATE "transfer_offers" SET "turn" = CASE WHEN "kind" = 'player_proposal' THEN 'club' ELSE 'player' END`,
    );
    await queryRunner.query(`ALTER TABLE "transfer_offers" ALTER COLUMN "turn" SET NOT NULL`);

    // Club money held per offer (open club offers and accepted deals still waiting to complete).
    await queryRunner.query(`ALTER TABLE "transfer_offers" ADD "heldTk" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`
      UPDATE "transfer_offers" SET "heldTk" = "amountTk"
       WHERE "paidAt" IS NOT NULL AND "amountTk" > 0 AND "status" IN ('pending', 'scheduled')`);

    // The opening bid of every existing offer.
    await queryRunner.query(`
      INSERT INTO "transfer_offer_bids" ("offerId", "party", "byUserId", "amountTk", "message", "createdAt")
      SELECT "id", CASE WHEN "kind" = 'player_proposal' THEN 'player' ELSE 'club' END,
             "createdByUserId", "amountTk", "message", "createdAt"
        FROM "transfer_offers"`);

    // Members with no contract (e.g. a former President / GS) start one now.
    await queryRunner.query(`
      WITH s AS (
        SELECT COALESCE((SELECT ("value"->>'baseFeeTk')::int FROM "app_settings" WHERE "key" = 'transfers'), 120) AS base,
               COALESCE((SELECT ("value"->>'lockDays')::int FROM "app_settings" WHERE "key" = 'transfers'), 120) AS days
      )
      INSERT INTO "player_contracts" ("contractNo", "userId", "clubId", "frozenTk", "baseTk", "lockDays", "startAt", "lockEndsAt")
      SELECT 'ALQ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('contract_no_seq')::text, 6, '0'),
             ep."userId", ep."clubId", 0, s.base, s.days, now(), now() + make_interval(days => s.days)
        FROM "efootball_profiles" ep CROSS JOIN s
       WHERE ep."clubId" IS NOT NULL
         AND COALESCE(ep."clubRole"::text, 'Player') NOT IN ('President', 'General Secretary')
         AND NOT EXISTS (SELECT 1 FROM "player_contracts" c WHERE c."userId" = ep."userId" AND c."status" = 'active')`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transfer_offers" DROP COLUMN "turn", DROP COLUMN "heldTk"`);
    await queryRunner.query(`DROP TABLE "transfer_offer_bids"`);
  }
}
