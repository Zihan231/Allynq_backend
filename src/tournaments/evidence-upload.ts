import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface.js';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { diskStorage } from 'multer';

/** Match evidence lives on disk under uploads/evidence and is served at /uploads/evidence/…. */
export const EVIDENCE_DIR = join(process.cwd(), 'uploads', 'evidence');
export const EVIDENCE_URL_PREFIX = '/uploads/evidence/';

export const MAX_SCREENSHOTS = 3;
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

export interface EvidenceFiles {
  screenshots?: Express.Multer.File[];
  video?: Express.Multer.File[];
}

/** Streams uploads straight to disk (no base64 / memory buffering), with type and size limits. */
export const evidenceUploadOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, callback) => {
      if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });
      callback(null, EVIDENCE_DIR);
    },
    filename: (_req, file, callback) => {
      callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: MAX_VIDEO_BYTES, files: MAX_SCREENSHOTS + 1 },
  fileFilter: (_req, file, callback) => {
    const allowed = file.fieldname === 'video' ? VIDEO_TYPES : IMAGE_TYPES;
    if (!allowed.includes(file.mimetype)) {
      callback(
        new BadRequestException(
          file.fieldname === 'video'
            ? 'Video must be MP4, WebM or MOV'
            : 'Screenshots must be PNG, JPEG or WebP images',
        ),
        false,
      );
      return;
    }
    callback(null, true);
  },
};

export function evidenceUrl(file: Express.Multer.File): string {
  return `${EVIDENCE_URL_PREFIX}${file.filename}`;
}

/** Deletes evidence files by URL; missing files and foreign URLs are ignored. */
export async function removeEvidence(urls: Array<string | null | undefined>): Promise<void> {
  await Promise.all(
    urls
      .filter((url): url is string => Boolean(url?.startsWith(EVIDENCE_URL_PREFIX)))
      .map((url) => fs.unlink(join(EVIDENCE_DIR, url.slice(EVIDENCE_URL_PREFIX.length))).catch(() => undefined)),
  );
}
