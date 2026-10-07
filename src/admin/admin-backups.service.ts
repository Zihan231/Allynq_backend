import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { access, mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { DataSource, Repository } from 'typeorm';
import type { User } from '../users/entities/user.entity.js';
import { AuditService } from './audit.service.js';
import { PlatformBackup } from './entities/platform-backup.entity.js';

const gzipAsync = promisify(gzip);
const MAGIC = Buffer.from('ALLYNCBK1');
type Actor = Pick<User, 'id' | 'name' | 'systemRole'>;

/** Creates encrypted logical snapshots. Restores are intentionally an offline operator action. */
@Injectable()
export class AdminBackupsService {
  private readonly directory: string;
  private readonly encryptionKey: Buffer;

  constructor(
    @InjectRepository(PlatformBackup)
    private readonly backups: Repository<PlatformBackup>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.directory =
      config.get<string>('BACKUP_DIRECTORY') ?? join(process.cwd(), 'backups');
    const secret =
      config.get<string>('BACKUP_ENCRYPTION_KEY') ??
      config.get<string>('JWT_SECRET') ??
      'allync-backup-key';
    this.encryptionKey = createHash('sha256').update(secret).digest();
  }

  list() {
    return this.backups.find({ order: { createdAt: 'DESC' }, take: 100 });
  }

  async create(actor: Actor, ip?: string | null) {
    const row = await this.backups.save(
      this.backups.create({
        status: 'creating',
        fileName: null,
        sizeBytes: null,
        checksumSha256: null,
        failure: null,
        createdById: actor.id,
      }),
    );
    try {
      const tables = await this.consistentSnapshot();
      const payload = Buffer.from(
        JSON.stringify({
          format: 1,
          createdAt: new Date().toISOString(),
          database: this.dataSource.options.database ?? null,
          tables,
        }),
      );
      const compressed = await gzipAsync(payload, { level: 9 });
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
      const encrypted = Buffer.concat([
        cipher.update(compressed),
        cipher.final(),
      ]);
      const output = Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
      await mkdir(this.directory, { recursive: true });
      const fileName = `allync-${row.id}.backup`;
      await writeFile(join(this.directory, fileName), output, { flag: 'wx' });
      row.status = 'ready';
      row.fileName = fileName;
      row.sizeBytes = String(output.byteLength);
      row.checksumSha256 = createHash('sha256').update(output).digest('hex');
      await this.backups.save(row);
      await this.audit.record(actor, {
        action: 'backup.create',
        targetType: 'backup',
        targetId: row.id,
        targetName: fileName,
        after: { sizeBytes: row.sizeBytes, checksumSha256: row.checksumSha256 },
        ip,
      });
      return row;
    } catch (error) {
      row.status = 'failed';
      row.failure = (error as Error).message.slice(0, 2000);
      await this.backups.save(row);
      throw error;
    }
  }

  async file(id: string, actor: Actor, ip?: string | null) {
    const row = await this.backups.findOne({ where: { id } });
    if (!row || row.status !== 'ready' || !row.fileName)
      throw new NotFoundException('Backup file not found');
    const safeName = basename(row.fileName);
    const path = join(this.directory, safeName);
    try {
      await access(path);
      const info = await stat(path);
      await this.audit.record(actor, {
        action: 'backup.download',
        targetType: 'backup',
        targetId: row.id,
        targetName: safeName,
        ip,
      });
      return { row, path, size: info.size, fileName: safeName };
    } catch {
      throw new NotFoundException(
        'Backup metadata exists, but its file is unavailable',
      );
    }
  }

  async remove(actor: Actor, id: string, ip?: string | null) {
    const row = await this.backups.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Backup not found');
    if (row.fileName) {
      try {
        await unlink(join(this.directory, basename(row.fileName)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    await this.backups.remove(row);
    await this.audit.record(actor, {
      action: 'backup.delete',
      targetType: 'backup',
      targetId: id,
      targetName: row.fileName,
      ip,
    });
    return { success: true };
  }

  /** Reads every table from one repeatable-read, read-only PostgreSQL snapshot. */
  private async consistentSnapshot(): Promise<Record<string, unknown[]>> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction('REPEATABLE READ');
      await runner.query('SET TRANSACTION READ ONLY');
      const tableRows: Array<{ tablename: string }> = await runner.query(
        `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      );
      const tables: Record<string, unknown[]> = {};
      for (const { tablename } of tableRows) {
        if (tablename === 'platform_backups' || tablename === 'migrations')
          continue;
        const quoted = `"${tablename.replaceAll('"', '""')}"`;
        tables[tablename] = await runner.query(`SELECT * FROM ${quoted}`);
      }
      await runner.commitTransaction();
      return tables;
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }
}
