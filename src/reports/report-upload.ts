import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface.js';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, promises as fs } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { diskStorage } from 'multer';

/** Report proof images live on disk under uploads/reports and are served at /uploads/reports/…. */
export const REPORTS_DIR = join(process.cwd(), 'uploads', 'reports');
export const REPORTS_URL_PREFIX = '/uploads/reports/';
export const MAX_REPORT_IMAGES = 3;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Streams proof images straight to disk, PNG / JPEG / WebP up to 10 MB each. */
export const reportUploadOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, callback) => {
      if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
      callback(null, REPORTS_DIR);
    },
    filename: (_req, file, callback) => {
      callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_REPORT_IMAGES },
  fileFilter: (_req, file, callback) => {
    if (!IMAGE_TYPES.includes(file.mimetype)) {
      callback(new BadRequestException('Proof must be PNG, JPEG or WebP images'), false);
      return;
    }
    callback(null, true);
  },
};

export const reportFileUrl = (file: Express.Multer.File) => `${REPORTS_URL_PREFIX}${file.filename}`;

/** Deletes uploaded proof (e.g. when the report is refused). */
export async function removeReportFiles(urls: string[]): Promise<void> {
  await Promise.all(
    urls
      .filter((url) => url.startsWith(REPORTS_URL_PREFIX))
      .map((url) => fs.unlink(join(REPORTS_DIR, basename(url))).catch(() => undefined)),
  );
}
