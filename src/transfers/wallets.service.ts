import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { SettingsService } from '../settings/settings.service.js';
import { Wallet, type WalletOwnerType } from './entities/wallet.entity.js';
import { WalletTransaction, type WalletTransactionKind } from './entities/wallet-transaction.entity.js';

export interface WalletOwner {
  type: WalletOwnerType;
  id: string;
}

export interface WalletView {
  balanceTk: number;
  heldTk: number;
  transactions: Array<{
    id: string;
    kind: WalletTransactionKind;
    amountTk: number;
    counterparty: string | null;
    reference: string | null;
    offerId: string | null;
    createdAt: Date;
  }>;
}

/**
 * Demo wallets for players and clubs. Every change runs inside the caller's
 * transaction (`em`) and locks the wallet row, so concurrent payments can't
 * overspend. A new wallet starts with the configured demo balance.
 */
@Injectable()
export class WalletsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
  ) {}

  /** The owner's wallet, created with the starting balance if missing, locked for update. */
  async lock(em: EntityManager, owner: WalletOwner): Promise<Wallet> {
    const settings = await this.settingsService.transfers();
    const start = owner.type === 'club' ? settings.clubStartingBalanceTk : settings.playerStartingBalanceTk;
    await em.query(
      `INSERT INTO wallets ("ownerType", "ownerId", "balanceTk") VALUES ($1, $2, $3)
       ON CONFLICT ("ownerType", "ownerId") DO NOTHING`,
      [owner.type, owner.id, start],
    );
    return em
      .getRepository(Wallet)
      .createQueryBuilder('w')
      .setLock('pessimistic_write')
      .where('w."ownerType" = :type AND w."ownerId" = :id', owner)
      .getOneOrFail();
  }

  async view(owner: WalletOwner, limit = 20): Promise<WalletView> {
    return this.dataSource.transaction(async (em) => {
      const wallet = await this.lock(em, owner);
      const transactions = await em.getRepository(WalletTransaction).find({
        where: { walletId: wallet.id },
        order: { createdAt: 'DESC' },
        take: limit,
      });
      return { balanceTk: wallet.balanceTk, heldTk: wallet.heldTk, transactions };
    });
  }

  /**
   * Paginated ledger for a wallet, newest first, optionally one kind only, with
   * running totals (all time) for the summary tiles.
   */
  async history(owner: WalletOwner, query: { kind?: WalletTransactionKind; page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return this.dataSource.transaction(async (em) => {
      const wallet = await this.lock(em, owner);
      const repo = em.getRepository(WalletTransaction);
      const where = { walletId: wallet.id, ...(query.kind ? { kind: query.kind } : {}) };
      const [rows, total] = await repo.findAndCount({ where, order: { createdAt: 'DESC' }, skip: (page - 1) * limit, take: limit });
      const sums: Array<{ kind: WalletTransactionKind; total: number }> = await em.query(
        `SELECT kind, COALESCE(sum(abs("amountTk")), 0)::int AS total FROM wallet_transactions WHERE "walletId" = $1 GROUP BY kind`,
        [wallet.id],
      );
      const totals = Object.fromEntries(sums.map((r) => [r.kind, r.total])) as Partial<Record<WalletTransactionKind, number>>;
      return {
        balanceTk: wallet.balanceTk,
        heldTk: wallet.heldTk,
        totals: {
          receivedTk: totals.received ?? 0,
          paidTk: totals.payout_sent ?? 0,
          refundedTk: totals.refund ?? 0,
          topUpTk: totals.top_up ?? 0,
        },
        data: rows,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
      };
    });
  }

  /** "Add demo funds". */
  async topUp(owner: WalletOwner): Promise<{ wallet: Wallet; amountTk: number }> {
    const { demoTopUpTk } = await this.settingsService.transfers();
    const wallet = await this.dataSource.transaction(async (em) => {
      const w = await this.lock(em, owner);
      w.balanceTk += demoTopUpTk;
      await em.save(w);
      await this.record(em, w, 'top_up', demoTopUpTk, { counterparty: 'Demo funds' });
      return w;
    });
    return { wallet, amountTk: demoTopUpTk };
  }

  /** Moves money from the spendable balance into the held amount, for an open offer. */
  async hold(
    em: EntityManager,
    owner: WalletOwner,
    amountTk: number,
    ref: { offerId: string; counterparty: string; reference: string | null },
  ): Promise<void> {
    if (amountTk <= 0) return;
    const w = await this.lock(em, owner);
    if (w.balanceTk < amountTk) {
      throw new BadRequestException(
        `Not enough money in the wallet: ${amountTk} tk needed, ${w.balanceTk} tk available. Add demo funds first.`,
      );
    }
    w.balanceTk -= amountTk;
    w.heldTk += amountTk;
    await em.save(w);
    await this.record(em, w, 'hold', -amountTk, ref);
  }

  /** Returns held money to the spendable balance (offer declined / cancelled / expired). */
  async refund(
    em: EntityManager,
    owner: WalletOwner,
    amountTk: number,
    ref: { offerId: string; counterparty: string },
  ): Promise<void> {
    if (amountTk <= 0) return;
    const w = await this.lock(em, owner);
    const back = Math.min(amountTk, w.heldTk);
    w.heldTk -= back;
    w.balanceTk += back;
    await em.save(w);
    await this.record(em, w, 'refund', back, ref);
  }

  /** Pays held money out to the payee (transfer completed). */
  async payOut(
    em: EntityManager,
    from: WalletOwner,
    to: WalletOwner,
    amountTk: number,
    ref: { offerId: string; fromName: string; toName: string; reference: string | null },
  ): Promise<void> {
    if (amountTk <= 0) return;
    const payer = await this.lock(em, from);
    payer.heldTk = Math.max(0, payer.heldTk - amountTk);
    await em.save(payer);
    await this.record(em, payer, 'payout_sent', amountTk, {
      offerId: ref.offerId,
      counterparty: ref.toName,
      reference: ref.reference,
    });

    const payee = await this.lock(em, to);
    payee.balanceTk += amountTk;
    await em.save(payee);
    await this.record(em, payee, 'received', amountTk, {
      offerId: ref.offerId,
      counterparty: ref.fromName,
      reference: ref.reference,
    });
  }

  /**
   * A staff correction or a reversal: adds (positive) or removes (negative) spendable money.
   * Never takes the balance below zero.
   */
  async adjust(
    em: EntityManager,
    owner: WalletOwner,
    amountTk: number,
    kind: 'adjustment' | 'reversal',
    ref: { offerId?: string | null; counterparty: string },
  ): Promise<Wallet> {
    const w = await this.lock(em, owner);
    if (w.balanceTk + amountTk < 0) {
      throw new BadRequestException(`The wallet only has ${w.balanceTk} tk available, so ${-amountTk} tk can't be taken.`);
    }
    w.balanceTk += amountTk;
    await em.save(w);
    await this.record(em, w, kind, amountTk, { offerId: ref.offerId ?? null, counterparty: ref.counterparty });
    return w;
  }

  private async record(
    em: EntityManager,
    wallet: Wallet,
    kind: WalletTransactionKind,
    amountTk: number,
    ref: { offerId?: string | null; counterparty?: string | null; reference?: string | null },
  ): Promise<void> {
    await em.getRepository(WalletTransaction).insert({
      walletId: wallet.id,
      kind,
      amountTk,
      offerId: ref.offerId ?? null,
      counterparty: ref.counterparty ?? null,
      reference: ref.reference ?? null,
    });
  }
}
