import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Staff can freeze a club or community: it stays visible, but can't run tournaments,
 * register for them, make transfer deals or edit itself until it is unfrozen.
 */
export class AddFreeze1792000000000 implements MigrationInterface {
  name = 'AddFreeze1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['clubs', 'communities']) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
          ADD "frozenAt" timestamptz,
          ADD "frozenReason" text,
          ADD "frozenById" uuid REFERENCES "users"("id") ON DELETE SET NULL`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['clubs', 'communities']) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "frozenAt", DROP COLUMN "frozenReason", DROP COLUMN "frozenById"`);
    }
  }
}
