import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface.js';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, promises as fs } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { diskStorage } from 'multer';
import type { DesignAssets, StoreItemCategory } from '../admin/entities/store-item.entity.js';

/** Creator design files live on disk under uploads/creators and are served at /uploads/creators/…. */
export const CREATORS_DIR = join(process.cwd(), 'uploads', 'creators');
export const CREATORS_URL_PREFIX = '/uploads/creators/';
const IMAGE_TYPES = ['image/png', 'image/webp', 'image/jpeg'];
const MB = 1024 * 1024;

/** The categories a creator can design (titles stay ALLYNQ's: they read as a claim). */
export const CREATOR_CATEGORIES = ['badge', 'frame', 'theme', 'club_theme', 'tournament_banner', 'sticker_pack'] as const;
export type CreatorCategory = (typeof CREATOR_CATEGORIES)[number];

export const MAX_STICKERS = 12;
export const MIN_STICKERS = 4;

export interface DesignFiles {
  image?: Express.Multer.File[];
  frame?: Express.Multer.File[];
  banner?: Express.Multer.File[];
  stickers?: Express.Multer.File[];
}

export const DESIGN_FILE_FIELDS = [
  { name: 'image', maxCount: 1 },
  { name: 'frame', maxCount: 1 },
  { name: 'banner', maxCount: 1 },
  { name: 'stickers', maxCount: MAX_STICKERS },
];

export const designUploadOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, callback) => {
      if (!existsSync(CREATORS_DIR)) mkdirSync(CREATORS_DIR, { recursive: true });
      callback(null, CREATORS_DIR);
    },
    filename: (_req, file, callback) => callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * MB, files: MAX_STICKERS + 3 },
  fileFilter: (_req, file, callback) => {
    if (!IMAGE_TYPES.includes(file.mimetype)) {
      callback(new BadRequestException('Designs must be PNG, WebP or JPEG images'), false);
      return;
    }
    callback(null, true);
  },
};

const urlOf = (file: Express.Multer.File) => `${CREATORS_URL_PREFIX}${file.filename}`;
const allFiles = (files: DesignFiles) => [...(files.image ?? []), ...(files.frame ?? []), ...(files.banner ?? []), ...(files.stickers ?? [])];

function limit(file: Express.Multer.File, maxBytes: number, what: string) {
  if (file.size > maxBytes) throw new BadRequestException(`${what} must be ${Math.round(maxBytes / 1024)} KB or smaller`);
}

/**
 * The files a design of this category needs, checked and turned into its assets:
 * badge = one image (≤1 MB), frame = one transparent PNG (≤1 MB), themes and banners =
 * one banner (≤5 MB), sticker pack = 4–12 stickers (≤512 KB each). With `partial`, missing
 * files are allowed (an edit that changes only some of them).
 */
export function assetsFromFiles(category: StoreItemCategory, files: DesignFiles, partial = false): DesignAssets {
  const unexpected = (field: keyof DesignFiles) => {
    if (files[field]?.length) throw new BadRequestException(`A ${category.replace('_', ' ')} doesn't take a ${field} file`);
  };
  const need = (field: keyof DesignFiles, what: string) => {
    const f = files[field]?.[0];
    if (!f && !partial) throw new BadRequestException(`Upload the ${what}`);
    return f;
  };
  switch (category) {
    case 'badge': {
      (['frame', 'banner', 'stickers'] as const).forEach(unexpected);
      const f = need('image', 'badge image');
      if (f) limit(f, MB, 'The badge image');
      return f ? { imageUrl: urlOf(f) } : {};
    }
    case 'frame': {
      (['image', 'banner', 'stickers'] as const).forEach(unexpected);
      const f = need('frame', 'frame (a transparent PNG)');
      if (f) {
        if (f.mimetype !== 'image/png') throw new BadRequestException('A frame must be a transparent PNG');
        limit(f, MB, 'The frame');
      }
      return f ? { frameUrl: urlOf(f) } : {};
    }
    case 'theme':
    case 'club_theme':
    case 'tournament_banner': {
      (['image', 'frame', 'stickers'] as const).forEach(unexpected);
      const f = need('banner', 'banner image');
      if (f) limit(f, 5 * MB, 'The banner');
      return f ? { bannerUrl: urlOf(f) } : {};
    }
    case 'sticker_pack': {
      (['image', 'frame', 'banner'] as const).forEach(unexpected);
      const list = files.stickers ?? [];
      if (!(partial && !list.length) && (list.length < MIN_STICKERS || list.length > MAX_STICKERS)) {
        throw new BadRequestException(`A sticker pack has ${MIN_STICKERS} to ${MAX_STICKERS} stickers`);
      }
      list.forEach((f) => limit(f, 512 * 1024, 'Each sticker'));
      return list.length ? { stickers: list.map(urlOf) } : {};
    }
    default:
      throw new BadRequestException("Creators can't make this kind of item");
  }
}

/** Removes uploaded files (a refused upload, a rejected or deleted design). */
export async function removeDesignFiles(input: DesignFiles | Array<string | undefined>): Promise<void> {
  const urls = Array.isArray(input) ? input : allFiles(input).map(urlOf);
  await Promise.all(
    urls
      .filter((u): u is string => Boolean(u?.startsWith(CREATORS_URL_PREFIX)))
      .map((u) => fs.unlink(join(CREATORS_DIR, basename(u))).catch(() => undefined)),
  );
}

/** Every file URL in a set of assets. */
export const assetUrls = (a: DesignAssets | null | undefined): string[] =>
  a ? [a.imageUrl, a.bannerUrl, a.frameUrl, ...(a.stickers ?? [])].filter((u): u is string => Boolean(u)) : [];
