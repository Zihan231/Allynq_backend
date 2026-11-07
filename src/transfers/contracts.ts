import type { TransferSettings } from '../settings/settings.service.js';
import { formatContractNo, lockEnd } from './contract-fee.js';

type QueryRunnerLike = { query: (sql: string, params?: unknown[]) => Promise<any> };

/**
 * The next contract number. One counter row, locked (`FOR UPDATE`) until the caller's transaction ends, so two contracts
 * can never get the same number. Always call it inside the transaction that inserts the contract.
 */
async function nextContractSeq(em: QueryRunnerLike): Promise<number> {
  await em.query(`INSERT IGNORE INTO contract_counters (id, value) VALUES (1, 0)`);
  const [row] = await em.query(`SELECT value FROM contract_counters WHERE id = 1 FOR UPDATE`);
  const seq = Number(row.value) + 1;
  await em.query(`UPDATE contract_counters SET value = $1 WHERE id = 1`, [seq]);
  return seq;
}

/** Starts a new active contract (the caller ends any previous one first). */
export async function startContract(
  em: QueryRunnerLike,
  settings: Pick<TransferSettings, 'baseFeeTk' | 'lockDays'>,
  terms: { userId: string; clubId: string; offerId?: string | null; frozenTk?: number },
  now = new Date(),
): Promise<void> {
  const seq = await nextContractSeq(em);
  await em.query(
    `INSERT INTO player_contracts (id, "contractNo", "userId", "clubId", "offerId", "frozenTk", "baseTk", "lockDays", "startAt", "lockEndsAt", status)
     VALUES (UUID(), $1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')`,
    [
      formatContractNo(seq, now),
      terms.userId,
      terms.clubId,
      terms.offerId ?? null,
      terms.frozenTk ?? 0,
      settings.baseFeeTk,
      settings.lockDays,
      now,
      lockEnd(now, settings.lockDays),
    ],
  );
}

/**
 * Every non-leader club member is under contract: gives a 0 tk contract to a member
 * who has none (e.g. a President or General Secretary who just became a Player).
 */
export async function ensureContract(
  em: QueryRunnerLike,
  settings: Pick<TransferSettings, 'baseFeeTk' | 'lockDays'>,
  userId: string,
  clubId: string,
): Promise<boolean> {
  const [existing] = await em.query(`SELECT id FROM player_contracts WHERE "userId" = $1 AND status = 'active'`, [userId]);
  if (existing) return false;
  await startContract(em, settings, { userId, clubId });
  return true;
}
