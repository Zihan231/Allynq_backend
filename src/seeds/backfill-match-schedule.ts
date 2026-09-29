import 'dotenv/config';
import { DataSource } from 'typeorm';
import {
  assignRange,
  DAY_MS,
  FIRST_GAME_DELAY_MS,
  firstPlayableDay,
  normalizePlayHours,
} from '../tournaments/bracket/schedule.js';

/**
 * Gives a 3-hour playing range to games generated before match scheduling
 * existed (scheduledStart is null), using the same rules as fixture
 * generation. Only unfinished games without a time are touched.
 *
 *   node --loader ts-node/esm src/seeds/backfill-match-schedule.ts [tournamentId]
 */
async function main() {
  const [tournamentId] = process.argv.slice(2);
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    synchronize: false,
  });
  await dataSource.initialize();

  try {
    const games: Array<{
      id: string;
      tournamentId: string;
      tournamentName: string;
      startAt: Date;
      playHoursStart: number | null;
      playHoursEnd: number | null;
      stage: string;
      round: number;
    }> = await dataSource.query(
      `SELECT g.id, t.id AS "tournamentId", t.name AS "tournamentName", t."startAt", t."playHoursStart", t."playHoursEnd",
              m.stage, m.round
         FROM tournament_match_games g
         JOIN tournament_matches m ON m.id = g."matchId"
         JOIN tournaments t ON t.id = m."tournamentId"
        WHERE g."scheduledStart" IS NULL
          AND g.status IN ('pending', 'awaiting_opponent', 'submitted', 'rejected')
          AND m.status NOT IN ('completed', 'bye')
          ${tournamentId ? 'AND t.id = $1' : ''}
        ORDER BY t.id, m.stage, m.round`,
      tournamentId ? [tournamentId] : [],
    );

    const byTournament = new Map<string, typeof games>();
    for (const game of games) byTournament.set(game.tournamentId, [...(byTournament.get(game.tournamentId) ?? []), game]);

    for (const [, rows] of byTournament) {
      const { tournamentName, startAt, playHoursStart, playHoursEnd } = rows[0];
      const hours = normalizePlayHours(playHoursStart, playHoursEnd);
      const earliest = new Date(Math.max(new Date(startAt).getTime(), Date.now()) + FIRST_GAME_DELAY_MS);
      const firstDay = firstPlayableDay(earliest, hours);
      // Group matchday d → playable day d; knockout games on the first playable day.
      const minGroupRound = Math.min(...rows.filter((r) => r.stage === 'group').map((r) => r.round), Infinity);

      for (const game of rows) {
        const dayOffset = game.stage === 'group' ? game.round - (Number.isFinite(minGroupRound) ? minGroupRound : 1) : 0;
        const range = assignRange(firstDay + dayOffset * DAY_MS, hours, Math.random, earliest);
        await dataSource.query(
          `UPDATE tournament_match_games
              SET "scheduledStart" = $2, "scheduledEnd" = $3, "systemScheduledStart" = $2, "evidenceDeadline" = $4
            WHERE id = $1 AND "scheduledStart" IS NULL`,
          [game.id, range.start, range.end, range.evidenceDeadline],
        );
      }
      console.log(`Scheduled ${rows.length} game(s) in "${tournamentName}".`);
    }
    if (!byTournament.size) console.log('No unscheduled games found.');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
