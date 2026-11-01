import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The creator marketplace: store items designed by creators (reviewed by staff, paid out
 * to the creator minus the platform's cut), club themes, tournament banners and sticker
 * packs for feed comments. ALLYNQ's own items stay as they are (approved, for players).
 */
export class AddCreatorMarketplace1793200000000 implements MigrationInterface {
  name = 'AddCreatorMarketplace1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "store_items" ALTER COLUMN "category" TYPE varchar(24)`);
    await queryRunner.query(
      `ALTER TABLE "store_items" ADD "creatorUserId" uuid NULL REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(`ALTER TABLE "store_items" ADD "reviewStatus" varchar(16) NOT NULL DEFAULT 'approved'`);
    await queryRunner.query(`ALTER TABLE "store_items" ADD "target" varchar(16) NOT NULL DEFAULT 'player'`);
    await queryRunner.query(`ALTER TABLE "store_items" ADD "assets" jsonb NULL`);
    await queryRunner.query(`ALTER TABLE "store_items" ADD "pendingAssets" jsonb NULL`);
    await queryRunner.query(`ALTER TABLE "store_items" ADD "rejectReason" text NULL`);
    await queryRunner.query(`ALTER TABLE "store_items" ADD "reviewedById" uuid NULL`);
    await queryRunner.query(`ALTER TABLE "store_items" ADD "reviewedAt" timestamptz NULL`);
    await queryRunner.query(`ALTER TABLE "store_items" ADD "salesCount" int NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "store_items" ADD "revenueTk" int NOT NULL DEFAULT 0`);
    await queryRunner.query(`CREATE INDEX "IDX_store_items_creator" ON "store_items" ("creatorUserId")`);
    await queryRunner.query(`CREATE INDEX "IDX_store_items_review" ON "store_items" ("reviewStatus")`);

    // Club themes (bought by club leaders) and tournament banners (bought by organizers).
    await queryRunner.query(`ALTER TABLE "clubs" ADD "ownedThemeSkus" jsonb NOT NULL DEFAULT '[]'::jsonb`);
    await queryRunner.query(`ALTER TABLE "clubs" ADD "equippedThemeSku" varchar(64) NULL`);
    await queryRunner.query(`ALTER TABLE "tournaments" ADD "bannerSku" varchar(64) NULL`);

    // A sticker in a feed comment: { sku, index }.
    await queryRunner.query(`ALTER TABLE "coach_post_comments" ADD "sticker" jsonb NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "coach_post_comments" DROP COLUMN "sticker"`);
    await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN "bannerSku"`);
    await queryRunner.query(`ALTER TABLE "clubs" DROP COLUMN "equippedThemeSku"`);
    await queryRunner.query(`ALTER TABLE "clubs" DROP COLUMN "ownedThemeSkus"`);
    await queryRunner.query(`DROP INDEX "IDX_store_items_review"`);
    await queryRunner.query(`DROP INDEX "IDX_store_items_creator"`);
    for (const col of ['revenueTk', 'salesCount', 'reviewedAt', 'reviewedById', 'rejectReason', 'pendingAssets', 'assets', 'target', 'reviewStatus', 'creatorUserId']) {
      await queryRunner.query(`ALTER TABLE "store_items" DROP COLUMN "${col}"`);
    }
    await queryRunner.query(`ALTER TABLE "store_items" ALTER COLUMN "category" TYPE varchar(16)`);
  }
}
