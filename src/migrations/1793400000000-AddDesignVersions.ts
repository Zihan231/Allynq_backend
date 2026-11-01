import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Design versions: when staff approve a new look for a creator's design, the old look is
 * kept (`versions`) and owners choose which one they show (latest, or the one they had).
 * Owners' choices live per SKU on users and clubs; a tournament keeps the version of its
 * banner.
 */
export class AddDesignVersions1793400000000 implements MigrationInterface {
  name = 'AddDesignVersions1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "store_items" ADD "version" int NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "store_items" ADD "versions" jsonb NOT NULL DEFAULT '[]'::jsonb`);
    await queryRunner.query(`ALTER TABLE "users" ADD "designVersions" jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await queryRunner.query(`ALTER TABLE "clubs" ADD "designVersions" jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await queryRunner.query(`ALTER TABLE "tournaments" ADD "bannerVersion" int NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN "bannerVersion"`);
    await queryRunner.query(`ALTER TABLE "clubs" DROP COLUMN "designVersions"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "designVersions"`);
    await queryRunner.query(`ALTER TABLE "store_items" DROP COLUMN "versions"`);
    await queryRunner.query(`ALTER TABLE "store_items" DROP COLUMN "version"`);
  }
}
