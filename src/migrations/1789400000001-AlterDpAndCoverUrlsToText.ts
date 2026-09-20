import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterDpAndCoverUrlsToText1789400000001 implements MigrationInterface {
  name = 'AlterDpAndCoverUrlsToText1789400000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "communities" ALTER COLUMN "dpUrl" TYPE text`);
    await queryRunner.query(`ALTER TABLE "communities" ALTER COLUMN "coverUrl" TYPE text`);
    await queryRunner.query(`ALTER TABLE "clubs" ALTER COLUMN "dpUrl" TYPE text`);
    await queryRunner.query(`ALTER TABLE "clubs" ALTER COLUMN "coverUrl" TYPE text`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "dpUrl" TYPE text`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "coverUrl" TYPE text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "communities" ALTER COLUMN "dpUrl" TYPE character varying(512)`);
    await queryRunner.query(`ALTER TABLE "communities" ALTER COLUMN "coverUrl" TYPE character varying(512)`);
    await queryRunner.query(`ALTER TABLE "clubs" ALTER COLUMN "dpUrl" TYPE character varying(512)`);
    await queryRunner.query(`ALTER TABLE "clubs" ALTER COLUMN "coverUrl" TYPE character varying(512)`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "dpUrl" TYPE character varying(512)`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "coverUrl" TYPE character varying(512)`);
  }
}
