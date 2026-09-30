import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Generating fixtures used to mark a tournament live straight away, even hours
 * before its start. It now waits for the start time (fixtures out →
 * `submission_phase`); move tournaments already marked live too early back.
 */
export class FixEarlyLiveTournaments1791100000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "tournaments" SET status = 'submission_phase'
             WHERE status = 'ongoing' AND format IS NOT NULL AND "startAt" > now()
        `);
    }

    public async down(): Promise<void> {
        // Data correction only: the deadline job puts these tournaments live at their start time.
    }
}
