import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mobile / console:
 * - players get a gaming platform, guessed from the device they entered (PlayStation,
 *   Xbox and PC → console; anything else → mobile); they can change it in their profile;
 * - tournaments get a platform (existing ones are mobile); console tournaments take
 *   console players only.
 */
export class AddGamingPlatform1792600000000 implements MigrationInterface {
  name = 'AddGamingPlatform1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "gamingPlatform" varchar(8) NOT NULL DEFAULT 'mobile'`);
    await queryRunner.query(`
      UPDATE "users" SET "gamingPlatform" = 'console'
       WHERE "deviceName" ~* '(playstation|xbox|steam|console|computer|laptop|desktop|(^|[^a-z])(ps[345]?|pc)([^a-z]|$))'`);
    await queryRunner.query(`ALTER TABLE "tournaments" ADD "platform" varchar(8) NOT NULL DEFAULT 'mobile'`);
    await queryRunner.query(`CREATE INDEX "IDX_tournaments_platform" ON "tournaments" ("platform")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_tournaments_platform"`);
    await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN "platform"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "gamingPlatform"`);
  }
}
