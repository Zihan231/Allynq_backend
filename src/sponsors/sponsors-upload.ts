import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface.js';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, promises as fs } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { diskStorage } from 'multer';

/** Sponsor logos and banners live on disk under uploads/sponsors, served at /uploads/sponsors/…. */
export const SPONSORS_DIR = join(process.cwd(), 'uploads', 'sponsors');
export const SPONSORS_URL_PREFIX = '/uploads/sponsors/';
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_LOGO_BYTES = 1024 * 1024;
const MAX_BANNER_BYTES = 5 * 1024 * 1024;

export const BRAND_FILE_FIELDS = [
  { name: 'logo', maxCount: 1 },
  { name: 'banner', maxCount: 1 },
];
export type BrandFiles = { logo?: Express.Multer.File[]; banner?: Express.Multer.File[] };

export const brandUploadOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, callback) => {
      if (!existsSync(SPONSORS_DIR)) mkdirSync(SPONSORS_DIR, { recursive: true });
      callback(null, SPONSORS_DIR);
    },
    filename: (_req, file, callback) => callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: MAX_BANNER_BYTES, files: 2 },
  fileFilter: (_req, file, callback) => {
    if (!IMAGE_TYPES.includes(file.mimetype)) {
      callback(new BadRequestException('Upload a PNG, JPEG or WebP image'), false);
      return;
    }
    callback(null, true);
  },
};

/** The URLs of an uploaded logo (≤1 MB) and banner (≤5 MB). */
export function brandUrls(files: BrandFiles): { logoUrl?: string; bannerUrl?: string } {
  const logo = files.logo?.[0];
  const banner = files.banner?.[0];
  if (logo && logo.size > MAX_LOGO_BYTES) throw new BadRequestException('The logo must be 1 MB or smaller');
  return {
    ...(logo ? { logoUrl: `${SPONSORS_URL_PREFIX}${logo.filename}` } : {}),
    ...(banner ? { bannerUrl: `${SPONSORS_URL_PREFIX}${banner.filename}` } : {}),
  };
}

/** Deletes sponsor uploads (refused uploads, or a replaced logo or banner). */
export async function removeBrandFiles(urls: Array<string | null | undefined>): Promise<void> {
  await Promise.all(
    urls
      .filter((url): url is string => Boolean(url?.startsWith(SPONSORS_URL_PREFIX)))
      .map((url) => fs.unlink(join(SPONSORS_DIR, basename(url))).catch(() => undefined)),
  );
}

export function uploadedBrandUrls(files: BrandFiles): string[] {
  return [...(files.logo ?? []), ...(files.banner ?? [])].map((f) => `${SPONSORS_URL_PREFIX}${f.filename}`);
}
