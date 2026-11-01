import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Store items may also be club themes, tournament banners and sticker packs (creator
 * designs). The category check from AddPhaseSixAdministration allowed only the four
 * profile categories.
 */
export class WidenStoreCategories1793300000000 implements MigrationInterface {
  name = 'WidenStoreCategories1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "store_items" DROP CONSTRAINT IF EXISTS "store_items_category_check"`);
    await queryRunner.query(
      `ALTER TABLE "store_items" ADD CONSTRAINT "store_items_category_check"
         CHECK (category IN ('badge', 'title', 'frame', 'theme', 'club_theme', 'tournament_banner', 'sticker_pack'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "store_items" DROP CONSTRAINT IF EXISTS "store_items_category_check"`);
    await queryRunner.query(
      `ALTER TABLE "store_items" ADD CONSTRAINT "store_items_category_check" CHECK (category IN ('badge', 'title', 'frame', 'theme'))`,
    );
  }
}
