import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Coach, creative artist and social media expert became sub-roles of a new esports
 * professional role. The default role needs room for its name, and existing users with
 * one of the sub-roles get the parent so they stay valid.
 */
export class AddEsportsProfessionalRole1793600000000 implements MigrationInterface {
  name = 'AddEsportsProfessionalRole1793600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "primaryRole" TYPE character varying(32)`);
    await queryRunner.query(
      `UPDATE "users" SET "roles" = "roles" || '["esports_professional"]'::jsonb
        WHERE "roles" ?| array['coach', 'creative', 'social'] AND NOT ("roles" ? 'esports_professional')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "users" SET "roles" = "roles" - 'esports_professional'`);
    await queryRunner.query(
      `UPDATE "users" SET "primaryRole" = 'player' WHERE "primaryRole" = 'esports_professional'`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "primaryRole" TYPE character varying(16)`);
  }
}
