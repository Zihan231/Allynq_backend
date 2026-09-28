import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * CvC roster presets are now 16v16, 12v12, 8v8 and 4v4 (even starters only).
 * '11v11' stays in the enum so existing tournaments keep loading.
 */
export class AddEvenTournamentPresets1790600000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "tournament_preset_enum" ADD VALUE IF NOT EXISTS '16v16'`);
        await queryRunner.query(`ALTER TYPE "tournament_preset_enum" ADD VALUE IF NOT EXISTS '12v12'`);
        await queryRunner.query(`ALTER TYPE "tournament_preset_enum" ADD VALUE IF NOT EXISTS '4v4'`);
    }

    public async down(): Promise<void> {
        // Postgres cannot drop enum values; the extra values are harmless.
    }

}
