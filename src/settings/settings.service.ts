import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSetting } from './app-setting.entity.js';

/** Transfer market settings. Change them in the `app_settings` row with key "transfers". */
export interface TransferSettings {
  /** The fixed part of every transfer fee, decaying to 0 over the lock. */
  baseFeeTk: number;
  /** How long a new contract locks the player in. */
  lockDays: number;
  /** How long an offer stays open before it expires (and any held money is refunded). */
  offerExpiryDays: number;
  clubStartingBalanceTk: number;
  playerStartingBalanceTk: number;
  /** "Add demo funds" top-up amount. */
  demoTopUpTk: number;
  /** Loans a club can have running at once (borrowed players, scheduled or on loan). */
  maxLoansPerClub: number;
  /** Most matches a loan can be agreed for. */
  maxLoanMatches: number;
  /** Most days a loan can last, whatever the matches played. */
  maxLoanDays: number;
}

export const DEFAULT_TRANSFER_SETTINGS: TransferSettings = {
  baseFeeTk: 120,
  lockDays: 120,
  offerExpiryDays: 3,
  clubStartingBalanceTk: 5000,
  playerStartingBalanceTk: 0,
  demoTopUpTk: 1000,
  maxLoansPerClub: 3,
  maxLoanMatches: 10,
  maxLoanDays: 60,
};

/** Admin and moderation settings (`app_settings` key "admin"). */
export interface AdminSettings {
  /** Days an item stays in the recycle bin before it is deleted for good. */
  binRetentionDays: number;
  /** Longest suspension a moderator may give; admins have no limit. */
  moderatorMaxSuspendDays: number;
  /** Reports one player may file in 24 hours. */
  reportDailyLimit: number;
  /** False-report strikes after which a player can no longer report. */
  reportStrikeLimit: number;
}

export const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  binRetentionDays: 30,
  moderatorMaxSuspendDays: 7,
  reportDailyLimit: 10,
  reportStrikeLimit: 3,
};

/** Platform switches (`app_settings` key "features"). */
export interface FeatureFlags {
  signupsOpen: boolean;
  transfersOpen: boolean;
  reportsOpen: boolean;
}

export const DEFAULT_FEATURES: FeatureFlags = { signupsOpen: true, transfersOpen: true, reportsOpen: true };

/** Maintenance mode (`app_settings` key "maintenance"): players can read but not change anything. */
export interface MaintenanceSettings {
  enabled: boolean;
  message: string;
}

export const DEFAULT_MAINTENANCE: MaintenanceSettings = { enabled: false, message: '' };

export type SettingsSection = 'transfers' | 'admin' | 'features' | 'maintenance';
const DEFAULTS: Record<SettingsSection, object> = {
  transfers: DEFAULT_TRANSFER_SETTINGS,
  admin: DEFAULT_ADMIN_SETTINGS,
  features: DEFAULT_FEATURES,
  maintenance: DEFAULT_MAINTENANCE,
};

const CACHE_MS = 30_000;

@Injectable()
export class SettingsService {
  private cache = new Map<string, { value: unknown; at: number }>();

  constructor(@InjectRepository(AppSetting) private readonly settingsRepository: Repository<AppSetting>) {}

  /** Transfer settings, with defaults for anything missing. Cached briefly. */
  async transfers(): Promise<TransferSettings> {
    return { ...DEFAULT_TRANSFER_SETTINGS, ...(await this.read<Partial<TransferSettings>>('transfers')) };
  }

  /** Overwrites some transfer settings; returns the full, updated set. */
  async updateTransfers(patch: Partial<TransferSettings>): Promise<TransferSettings> {
    const next = { ...(await this.transfers()), ...patch };
    await this.settingsRepository.save({ key: 'transfers', value: next as unknown as Record<string, unknown> });
    this.cache.delete('transfers');
    return next;
  }

  /** Admin settings, with defaults for anything missing. */
  async admin(): Promise<AdminSettings> {
    return { ...DEFAULT_ADMIN_SETTINGS, ...(await this.read<Partial<AdminSettings>>('admin')) };
  }

  async features(): Promise<FeatureFlags> {
    return { ...DEFAULT_FEATURES, ...(await this.read<Partial<FeatureFlags>>('features')) };
  }

  async maintenance(): Promise<MaintenanceSettings> {
    return { ...DEFAULT_MAINTENANCE, ...(await this.read<Partial<MaintenanceSettings>>('maintenance')) };
  }

  /** Any section with its defaults filled in. */
  async section<T extends object>(key: SettingsSection): Promise<T> {
    return { ...(DEFAULTS[key] as T), ...(await this.read<Partial<T>>(key)) };
  }

  /** Overwrites some fields of a section; returns the whole updated section. */
  async updateSection<T extends object>(key: SettingsSection, patch: Partial<T>): Promise<T> {
    const next = { ...(await this.section<T>(key)), ...patch };
    await this.settingsRepository.save({ key, value: next as unknown as Record<string, unknown> });
    this.cache.delete(key);
    return next;
  }

  private async read<T>(key: string): Promise<T | null> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
    const row = await this.settingsRepository.findOne({ where: { key } });
    const value = (row?.value as T | undefined) ?? null;
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }
}
