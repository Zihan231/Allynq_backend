import type { TransferSettings } from '../settings/settings.service.js';
import { formatContractNo, lockEnd } from './contract-fee.js';

type QueryRunnerLike = { query: (sql: string, params?: unknown[]) => Promise<any> };

/** Starts a new active contract (the caller ends any previous one first). */
export async function startContract(
  em: QueryRunnerLike,
  settings: Pick<TransferSettings, 'baseFeeTk' | 'lockDays'>,
  terms: { userId: string; clubId: string; offerId?: string | null; frozenTk?: number },
  now = new Date(),
): Promise<void> {
  const [{ seq }] = await em.query(`SELECT nextval('contract_no_seq')::int AS seq`);
  await em.query(
    `INSERT INTO player_contracts ("contractNo", "userId", "clubId", "offerId", "frozenTk", "baseTk", "lockDays", "startAt", "lockEndsAt", status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')`,
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
