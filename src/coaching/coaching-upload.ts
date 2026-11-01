import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface.js';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, promises as fs } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { diskStorage } from 'multer';
import type { CoachPostMedia } from './entities/coach-post.entity.js';

/** Coach post uploads live on disk under uploads/coaching and are served at /uploads/coaching/…. */
export const COACHING_DIR = join(process.cwd(), 'uploads', 'coaching');
export const COACHING_URL_PREFIX = '/uploads/coaching/';
export const MAX_POST_FILES = 4;
export const MAX_POST_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_POST_VIDEO_BYTES = 200 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

/** Streams post images (≤10 MB) and videos (≤200 MB) straight to disk. */
export const coachingUploadOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, callback) => {
      if (!existsSync(COACHING_DIR)) mkdirSync(COACHING_DIR, { recursive: true });
      callback(null, COACHING_DIR);
    },
    filename: (_req, file, callback) => {
      callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: MAX_POST_VIDEO_BYTES, files: MAX_POST_FILES },
  fileFilter: (_req, file, callback) => {
    if (!IMAGE_TYPES.includes(file.mimetype) && !VIDEO_TYPES.includes(file.mimetype)) {
      callback(new BadRequestException('Upload images (PNG, JPEG, WebP, GIF) or videos (MP4, WebM, MOV)'), false);
      return;
    }
    callback(null, true);
  },
};

/** The stored media of uploaded files; refuses an image over 10 MB (videos are capped by multer). */
export function toPostMedia(files: Express.Multer.File[]): CoachPostMedia[] {
  for (const file of files) {
    if (IMAGE_TYPES.includes(file.mimetype) && file.size > MAX_POST_IMAGE_BYTES) {
      throw new BadRequestException('Each image must be 10 MB or smaller');
    }
  }
  return files.map((file) => ({
    type: VIDEO_TYPES.includes(file.mimetype) ? 'video' : 'image',
    url: `${COACHING_URL_PREFIX}${file.filename}`,
  }));
}

/** Deletes uploaded files (a refused post, or one the coach deleted). */
export async function removeCoachingFiles(urls: string[]): Promise<void> {
  await Promise.all(
    urls
      .filter((url) => url.startsWith(COACHING_URL_PREFIX))
      .map((url) => fs.unlink(join(COACHING_DIR, basename(url))).catch(() => undefined)),
  );
}
