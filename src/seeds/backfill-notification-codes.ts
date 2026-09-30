import 'dotenv/config';
import { DataSource } from 'typeorm';

/**
 * Gives notifications saved before message codes existed (plain English text)
 * a `code` + `params`, so the app can show them in the viewer's language.
 * Each known English sentence is matched and its values extracted; anything
 * that doesn't match confidently keeps its English text. Only rows without a
 * code are touched, so it can be re-run safely.
 *
 *   node --loader ts-node/esm src/seeds/backfill-notification-codes.ts
 */

type Params = Record<string, string | number | null>;
type Row = { id: string; title: string; message: string; createdAt: Date };
type Rule = {
  title: RegExp;
  message: RegExp;
  build: (m: RegExpMatchArray, row: Row, t: RegExpMatchArray) => { code: string; params: Params } | null;
};

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "7:30 PM" → minutes after midnight. */
function minutesOf(time: string): number | null {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  const hours = (Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
  return hours * 60 + Number(m[2]);
}

/** A Bangladesh-time wall clock (day, month, minutes) → the UTC instant, in the year closest to `near`. */
function dhakaInstant(day: number, month: number, minutes: number, near: Date): Date {
  const candidates = [-1, 0, 1].map((dy) => {
    const year = near.getUTCFullYear() + dy;
    return new Date(Date.UTC(year, month, day) + minutes * 60_000 - DHAKA_OFFSET_MS);
  });
  return candidates.reduce((best, c) =>
    Math.abs(c.getTime() - near.getTime()) < Math.abs(best.getTime() - near.getTime()) ? c : best,
  );
}

/** "Thu 1 Oct, 7:30 PM – 10:30 PM" (Bangladesh time) → ISO start / end. */
function parseRange(text: string, near: Date): { startAt: string; endAt: string } | null {
  const m = text.match(/^\w{3} (\d{1,2}) ([A-Za-z]{3,4}), (\d{1,2}:\d{2}\s*[AP]M) – (\d{1,2}:\d{2}\s*[AP]M)$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
  const start = minutesOf(m[3]);
  const end = minutesOf(m[4]);
  if (month < 0 || start === null || end === null) return null;
  const startAt = dhakaInstant(Number(m[1]), month, start, near);
  const endAt = new Date(startAt.getTime() + (((end - start + 1440) % 1440) || 1440) * 60_000);
  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}

/** "9:30 PM" on the Bangladesh day of `near` (or the next day, if that's already past). */
function parseDeadline(time: string, near: Date): string | null {
  const minutes = minutesOf(time);
  if (minutes === null) return null;
  const local = new Date(near.getTime() + DHAKA_OFFSET_MS);
  let at = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + minutes * 60_000 - DHAKA_OFFSET_MS,
  );
  if (at.getTime() < near.getTime()) at = new Date(at.getTime() + 24 * 60 * 60 * 1000);
  return at.toISOString();
}

function rules(clubNames: Set<string>): Rule[] {
  const fixed = (title: string) => new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\!]/g, '\\$&')}$`);
  return [
    { title: fixed('Club Join Request'), message: /^(.+) requested to join (.+?)\.?$/, build: (m) => ({ code: 'club.joinRequest', params: { player: m[1], club: m[2] } }) },
    { title: fixed('Club Join Request Approved'), message: /^Your request to join (.+) has been approved! Welcome to the club\.$/, build: (m) => ({ code: 'club.joinApproved', params: { club: m[1] } }) },
    { title: fixed('Club Join Request Rejected'), message: /^Your request to join (.+) was declined\.$/, build: (m) => ({ code: 'club.joinRejected', params: { club: m[1] } }) },
    { title: fixed('New Club Member'), message: /^(.+) joined (.+) \(approved by (.+)\)$/, build: (m) => ({ code: 'club.memberJoinedApproved', params: { player: m[1], club: m[2], approvedBy: m[3] } }) },
    { title: fixed('New Club Member'), message: /^(.+) joined (.+)$/, build: (m) => ({ code: 'club.memberJoined', params: { player: m[1], club: m[2], approvedBy: null } }) },
    {
      title: fixed('Community Join Request'),
      message: /^(.+) requested to join (.+?)\.?$/,
      build: (m) =>
        clubNames.has(m[1])
          ? { code: 'community.joinRequestClub', params: { club: m[1], community: m[2] } }
          : { code: 'community.joinRequestPlayer', params: { player: m[1], community: m[2] } },
    },
    { title: fixed('Community Join Request Approved'), message: /^Your request to join (.+) has been approved!$/, build: (m) => ({ code: 'community.joinApproved', params: { community: m[1] } }) },
    {
      title: fixed('Community Join Request Rejected'),
      message: /^Your request to join (.+) was declined\.$/,
      build: (m) => ({ code: 'community.joinRejected', params: { community: m[1] === 'the community' ? null : m[1] } }),
    },
    { title: fixed('You are a match official'), message: /^You were appointed as a match official for "(.*)"\./, build: (m) => ({ code: 'tournament.officialAppointed', params: { tournament: m[1] } }) },
    {
      title: fixed('Tournament updated'),
      message: /^"(.*)" was updated by the organizer\. Changed: (.*)\.$/,
      build: (m) => ({ code: 'tournament.updated', params: { tournament: m[1], changes: m[2].split(', ').join(',') } }),
    },
    { title: fixed('Tournament cancelled'), message: /^"(.*)" has been deleted by the organizer and will not take place\.$/, build: (m) => ({ code: 'tournament.cancelled', params: { tournament: m[1] } }) },
    {
      title: fixed('Picked for a tournament'),
      message: /^(.+) picked you for "(.*)" — you're in the (starting lineup|bench)\.$/,
      build: (m) => ({ code: m[3] === 'bench' ? 'tournament.pickedSub' : 'tournament.pickedStarter', params: { club: m[1], tournament: m[2] } }),
    },
    {
      title: fixed('Tournament role changed'),
      message: /^(.+) moved you to the (starting lineup|bench) for "(.*)"\.$/,
      build: (m) => ({ code: m[2] === 'bench' ? 'tournament.movedToSub' : 'tournament.movedToStarter', params: { club: m[1], tournament: m[3] } }),
    },
    { title: fixed('Removed from tournament team'), message: /^(.+) removed you from its team for "(.*)"\.$/, build: (m) => ({ code: 'tournament.removedFromTeam', params: { club: m[1], tournament: m[2] } }) },
    {
      title: fixed('Fixtures are out'),
      message: /^The fixtures for "(.*)" have been drawn \((?:a straight knockout|(\d+) groups)\)\. Check your first match\.$/,
      build: (m) =>
        m[2]
          ? { code: 'tournament.fixturesOutGroups', params: { tournament: m[1], groups: Number(m[2]) } }
          : { code: 'tournament.fixturesOutKnockout', params: { tournament: m[1], groups: 1 } },
    },
    { title: fixed('Tournament finished'), message: /^"(.*)" has finished without a champion — both finalists forfeited\.$/, build: (m) => ({ code: 'tournament.finishedNoChampion', params: { tournament: m[1], champion: null } }) },
    { title: fixed('Tournament finished'), message: /^(.+) won "(.*)"! Congratulations to the champions\.$/, build: (m) => ({ code: 'tournament.finished', params: { tournament: m[2], champion: m[1] } }) },
    {
      title: /^(.+) is set$/,
      message: /^(.*) — your (.+) in "(.*)" is ready\.$/,
      build: (m, _row, t) => (t[1] === m[2] ? { code: 'tournament.roundSet', params: { round: m[2], tournament: m[3], entrants: m[1] } } : null),
    },
    {
      title: fixed('Knockout draw is out'),
      message: /^The group stage of "(.*)" is over\. (\d+) teams go through to the knockout — check the bracket\.$/,
      build: (m) => ({ code: 'tournament.knockoutDrawn', params: { tournament: m[1], count: Number(m[2]) } }),
    },
    {
      title: fixed('Match scheduled'),
      message: /^Your match vs (.+) in "(.*)" is scheduled for (.+) \(Bangladesh time\)\. Upload your evidence within 30 minutes after it ends\.$/,
      build: (m, row) => {
        const range = parseRange(m[3], row.createdAt);
        return range ? { code: 'tournament.matchScheduled', params: { tournament: m[2], opponent: m[1], count: 1, ...range } } : null;
      },
    },
    {
      title: fixed('Match scheduled'),
      message: /^You have (\d+) matches scheduled in "(.*)"\. First: vs (.+?), ((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Za-z]{3,4}, .+) \(Bangladesh time\)\.$/,
      build: (m, row) => {
        const range = parseRange(m[4], row.createdAt);
        return range ? { code: 'tournament.matchesScheduled', params: { tournament: m[2], opponent: m[3], count: Number(m[1]), ...range } } : null;
      },
    },
    {
      title: fixed('Result rejected — please resubmit'),
      message: /^Officials rejected the result of (.+?) vs (.+?) in "(.*)"(?:\.|: (.*)) Both players must upload new evidence within 24 hours, or the game is decided automatically\.$/,
      build: (m) => ({
        code: m[4] ? 'result.rejectedWithNote' : 'result.rejected',
        params: { playerA: m[1], playerB: m[2], tournament: m[3], note: m[4] ?? null },
      }),
    },
    {
      title: fixed('Result confirmed'),
      message: /^Officials confirmed (.+) (\d+)–(\d+) (.+) in "(.*)"\.$/,
      build: (m) => ({ code: 'result.confirmed', params: { playerA: m[1], goalsA: Number(m[2]), goalsB: Number(m[3]), playerB: m[4], tournament: m[5] } }),
    },
    {
      title: fixed('Your opponent uploaded evidence'),
      message: /^(.+) uploaded the result of (.+) in "(.*)"\. Upload your screenshots and video(?: before (\d{1,2}:\d{2}\s*[AP]M))? \(Bangladesh time\) or you lose the game\.$/,
      build: (m, row) => {
        const deadlineAt = m[4] ? parseDeadline(m[4], row.createdAt) : null;
        if (m[4] && !deadlineAt) return null;
        return {
          code: deadlineAt ? 'result.opponentUploaded' : 'result.opponentUploadedNoDeadline',
          params: { submitter: m[1], fixture: m[2], tournament: m[3], deadlineAt },
        };
      },
    },
    { title: fixed('Result ready for review'), message: /^Both players of (.+) in "(.*)" uploaded their evidence/, build: (m) => ({ code: 'result.readyForReview', params: { fixture: m[1], tournament: m[2] } }) },
    { title: fixed('You won by walkover'), message: /^Your opponent didn't upload evidence for (.+) in "(.*)" in time\. The game is yours\.$/, build: (m) => ({ code: 'result.wonWalkover', params: { fixture: m[1], tournament: m[2] } }) },
    { title: fixed('Game lost — no evidence'), message: /^You didn't upload evidence for (.+) in "(.*)" before the deadline, so your opponent wins the game\.$/, build: (m) => ({ code: 'result.lostNoEvidence', params: { fixture: m[1], tournament: m[2] } }) },
    { title: fixed('Game forfeited'), message: /^Neither player uploaded evidence for (.+) in "(.*)" before the deadline — it counts as a loss for both\.$/, build: (m) => ({ code: 'result.doubleForfeit', params: { fixture: m[1], tournament: m[2] } }) },
    { title: fixed('Knockout fixture needs a decision'), message: /^The knockout fixture with (.+) in "(.*)" ended level\./, build: (m) => ({ code: 'result.needsDecider', params: { fixture: m[1], tournament: m[2] } }) },
    {
      title: fixed('Time change requested'),
      message: /^(.+) wants to move your match in "(.*)" to (.+) \(Bangladesh time\)\. Accept or decline/,
      build: (m, row) => {
        const range = parseRange(m[3], row.createdAt);
        return range ? { code: 'schedule.changeRequested', params: { player: m[1], tournament: m[2], ...range } } : null;
      },
    },
    {
      title: fixed('Match time changed'),
      message: /^Your match (.+) in "(.*)" is now (.+) \(Bangladesh time\)\./,
      build: (m, row) => {
        const range = parseRange(m[3], row.createdAt);
        return range ? { code: 'schedule.changed', params: { fixture: m[1], tournament: m[2], ...range } } : null;
      },
    },
    {
      title: fixed('Time change declined'),
      message: /^(.+) declined your new time\. Your match in "(.*)" stays at (.+) \(Bangladesh time\)\.$/,
      build: (m, row) => {
        const range = parseRange(m[3], row.createdAt);
        return range ? { code: 'schedule.changeDeclined', params: { player: m[1], tournament: m[2], ...range } } : null;
      },
    },
    {
      title: fixed('Time change request expired'),
      message: /^Your opponent didn't answer in time\. Your match in "(.*)" stays at (.+) \(Bangladesh time\)\.$/,
      build: (m, row) => {
        const range = parseRange(m[2], row.createdAt);
        return range ? { code: 'schedule.changeExpired', params: { tournament: m[1], ...range } } : null;
      },
    },
    // Demo data (seed-full-demo) notices.
    { title: fixed('Tournament Registration Confirmed'), message: /^(.+) is registered for (.+)\.$/, build: (m) => ({ code: 'demo.registrationConfirmed', params: { club: m[1], tournament: m[2] } }) },
    { title: fixed('Tournament Started'), message: /^(.+) is live — check your quarter-final\.$/, build: (m) => ({ code: 'demo.tournamentStarted', params: { tournament: m[1] } }) },
    { title: fixed('Tournament Champions!'), message: /^(.+) won the (.+)\.$/, build: (m) => ({ code: 'demo.champions', params: { club: m[1], tournament: m[2] } }) },
  ];
}

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    synchronize: false,
  });
  await dataSource.initialize();

  try {
    const clubNames = new Set<string>((await dataSource.query(`SELECT name FROM clubs`)).map((c: { name: string }) => c.name));
    const allRules = rules(clubNames);
    const rows: Row[] = await dataSource.query(
      `SELECT id, title, message, "createdAt" FROM notifications WHERE code IS NULL`,
    );

    const updates: Array<{ id: string; code: string; params: Params }> = [];
    const unmatched = new Map<string, number>();
    for (const row of rows) {
      let result: { code: string; params: Params } | null = null;
      for (const rule of allRules) {
        const t = row.title.match(rule.title);
        const m = t && row.message.match(rule.message);
        if (t && m) {
          result = rule.build(m, { ...row, createdAt: new Date(row.createdAt) }, t);
          if (result) break;
        }
      }
      if (result) updates.push({ id: row.id, ...result });
      else unmatched.set(row.title, (unmatched.get(row.title) ?? 0) + 1);
    }

    for (let i = 0; i < updates.length; i += 400) {
      const batch = updates.slice(i, i + 400);
      const values: unknown[] = [];
      const tuples = batch.map((u) => {
        values.push(u.id, u.code, JSON.stringify(u.params));
        const n = values.length;
        return `($${n - 2}::uuid, $${n - 1}::varchar, $${n}::jsonb)`;
      });
      await dataSource.query(
        `UPDATE notifications n SET code = v.code, params = v.params
           FROM (VALUES ${tuples.join(', ')}) AS v(id, code, params)
          WHERE n.id = v.id AND n.code IS NULL`,
        values,
      );
    }

    console.log(`Coded ${updates.length} of ${rows.length} notification(s).`);
    if (unmatched.size) {
      console.log('Left in English (no matching pattern):');
      for (const [title, count] of unmatched) console.log(`  ${count} × ${title}`);
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
