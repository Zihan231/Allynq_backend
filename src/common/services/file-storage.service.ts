import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, promises as fs } from 'fs';
import { join } from 'path';

export type StorageFolder = 'communities' | 'clubs' | 'users';
export type ImageType = 'dp' | 'cover';

@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name);
  private readonly uploadsRoot = join(process.cwd(), 'uploads');

  constructor() {
    this.ensureDirectoryExists(this.uploadsRoot);
  }

  private ensureDirectoryExists(dirPath: string): void {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Saves a base64-encoded image string to the server filesystem under
   * uploads/<folder>/<type>/<uuid>.<ext> and returns the public URL path (/uploads/...).
   * If the input is already a URL or empty, it returns the input unchanged.
   */
  async saveBase64Image(
    dataUrl: string,
    folder: StorageFolder,
    type: ImageType,
  ): Promise<string>;
  async saveBase64Image(
    dataUrl: string | null | undefined,
    folder: StorageFolder,
    type: ImageType,
  ): Promise<string | null | undefined>;
  async saveBase64Image(
    dataUrl: string | null | undefined,
    folder: StorageFolder,
    type: ImageType,
  ): Promise<string | null | undefined> {
    if (!dataUrl) {
      return dataUrl;
    }

    // If it's not a base64 Data URL, it's already a saved URL (e.g. /uploads/... or http...)
    if (!dataUrl.startsWith('data:image/')) {
      return dataUrl;
    }

    try {
      const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (!matches) {
        this.logger.warn('Invalid base64 data URL format provided; saving as-is');
        return dataUrl;
      }

      let ext = matches[1].toLowerCase();
      if (ext === 'jpeg') ext = 'jpg';
      if (ext === 'svg+xml') ext = 'svg';

      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');

      const targetDir = join(this.uploadsRoot, folder, type);
      this.ensureDirectoryExists(targetDir);

      const fileName = `${randomUUID()}.${ext}`;
      const filePath = join(targetDir, fileName);

      await fs.writeFile(filePath, buffer);
      this.logger.log(`Saved image to ${filePath} (${(buffer.length / 1024).toFixed(1)} KB)`);

      return `/uploads/${folder}/${type}/${fileName}`;
    } catch (err) {
      this.logger.error('Failed to save base64 image to disk:', err);
      return dataUrl;
    }
  }
}
