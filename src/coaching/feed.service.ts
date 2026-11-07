import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service.js';
import { User } from '../users/entities/user.entity.js';
import { CoachPost } from './entities/coach-post.entity.js';
import { CoachProfile } from './entities/coach-profile.entity.js';
import { CoachPostComment } from './entities/feed.entities.js';

export type FeedTab = 'for_you' | 'following' | 'saved';
export const FEED_TABS: FeedTab[] = ['for_you', 'following', 'saved'];
const MAX_LIMIT = 20;

export interface FeedCommentView {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string; name: string; dpUrl: string | null };
  mine: boolean;
}

export interface FeedItem {
  id: string;
  body: string;
  links: string[];
  media: CoachPost['media'];
  createdAt: string;
  likeCount: number;
  commentCount: number;
  saveCount: number;
  likedByMe: boolean;
  savedByMe: boolean;
  /** The author (a coach, or a sponsor: then `role` is 'sponsor' and `brand` is set). */
  coach: { id: string; name: string; dpUrl: string | null; headline: string; specialities: string[]; followedByMe: boolean };
  author: {
    role: 'coach' | 'sponsor';
    brand: { name: string; logoUrl: string | null; verified: boolean } | null;
  };
  comments: FeedCommentView[];
}

export interface FeedPage {
  items: FeedItem[];
  /** Pass back to get the next page; null when there's nothing more. */
  nextCursor: string | null;
}

/** Page position: the moment the feed was opened (so the order holds while scrolling) and how far in. */
interface Cursor {
  asOf: string;
  offset: number;
}

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
function decodeCursor(raw: string | undefined): Cursor {
  if (!raw) return { asOf: new Date().toISOString(), offset: 0 };
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (Number.isNaN(Date.parse(c.asOf)) || !Number.isInteger(c.offset) || c.offset < 0) throw new Error('bad');
    return c;
  } catch {
    throw new BadRequestException('Invalid feed cursor');
  }
}

/**
 * The feed: approved coach posts and sponsor posts ("Sponsored"), ranked per viewer.
 *
 * "For you" score = engagement ÷ age, then personal boosts:
 *   (1 + likes + 2·comments + 3·saves) / (hours old + 2)^1.2
 *   × 3 for coaches you follow, × 2.5 for your club's coach,
 *   × 1.5 for coaches whose specialities match posts you liked or saved,
 *   × 2 for sponsors of your community or of tournaments you're in,
 *   × 0.25 for posts you've already seen, × 0.5 for your own.
 * Pages are ranked as of the moment the feed was opened (in the cursor), so the order
 * holds while scrolling; "Following" and "Saved" are newest first.
 */
@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {}

  async feed(viewerId: string | null, tab: FeedTab, rawCursor: string | undefined, rawLimit: number | undefined): Promise<FeedPage> {
    if ((tab === 'following' || tab === 'saved') && !viewerId) throw new ForbiddenException('Sign in to see this');
    const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit ?? 10));
    const cursor = decodeCursor(rawCursor);
    // Dates go in as Date objects: MySQL doesn't read ISO strings with a "T" and a "Z" as datetimes.
    const params: unknown[] = [viewerId, new Date(cursor.asOf), limit + 1, cursor.offset];

    const base = `
      FROM coach_posts p
      JOIN users u ON u.id = p."coachUserId" AND u."deletedAt" IS NULL AND u."bannedAt" IS NULL
      LEFT JOIN coach_profiles cp ON cp."userId" = p."coachUserId" AND p."authorRole" = 'coach'
      LEFT JOIN sponsor_profiles spp ON spp."userId" = p."coachUserId" AND p."authorRole" = 'sponsor'
      WHERE p.status = 'approved' AND p."deletedAt" IS NULL AND p."createdAt" <= $2::timestamptz
        AND (cp."userId" IS NOT NULL OR spp."userId" IS NOT NULL)`;

    let sql: string;
    if (tab === 'following') {
      sql = `SELECT p.id ${base}
               AND p."coachUserId" IN (SELECT "coachUserId" FROM coach_follows WHERE "followerUserId" = $1)
             ORDER BY p."createdAt" DESC, p.id LIMIT $3 OFFSET $4`;
    } else if (tab === 'saved') {
      sql = `SELECT p.id ${base.replace('WHERE', 'JOIN coach_post_saves s ON s."postId" = p.id AND s."userId" = $1 WHERE')}
             ORDER BY s."createdAt" DESC, p.id LIMIT $3 OFFSET $4`;
    } else {
      // The specialities of coaches whose posts this viewer liked or saved, as one JSON array ($5): MySQL can't turn a JSON array into rows.
      params.push(JSON.stringify(viewerId ? await this.likedSpecialities(viewerId) : []));
      sql = `
        WITH followed AS (SELECT "coachUserId" FROM coach_follows WHERE "followerUserId" = $1),
             club_coach AS (
               SELECT d."coachUserId" FROM coaching_deals d
                JOIN efootball_profiles ep ON ep."clubId" = d."clubId" AND ep."userId" = $1
               WHERE d.status = 'active'),
             my_sponsors AS (
               SELECT s."sponsorUserId" FROM sponsorships s
                WHERE s.status = 'active' AND (
                  s."communityId" IN (SELECT "communityId" FROM efootball_profiles WHERE "userId" = $1)
                  OR s."tournamentId" IN (SELECT "tournamentId" FROM tournament_participants WHERE "userId" = $1)))
        SELECT p.id,
          (1 + p."likeCount" + 2 * p."commentCount" + 3 * p."saveCount")
            / power(GREATEST(TIMESTAMPDIFF(SECOND, p."createdAt", $2) / 3600, 0) + 2, 1.2)
            * (CASE WHEN p."coachUserId" IN (SELECT "coachUserId" FROM followed) THEN 3 ELSE 1 END)
            * (CASE WHEN p."coachUserId" IN (SELECT "coachUserId" FROM club_coach) THEN 2.5 ELSE 1 END)
            * (CASE WHEN JSON_OVERLAPS(COALESCE(cp.specialities, JSON_ARRAY()), $5) THEN 1.5 ELSE 1 END)
            * (CASE WHEN p."authorRole" = 'sponsor' AND p."coachUserId" IN (SELECT "sponsorUserId" FROM my_sponsors) THEN 2 ELSE 1 END)
            * (CASE WHEN EXISTS (
                 SELECT 1 FROM coach_post_views v WHERE v."postId" = p.id AND v."userId" = $1 AND v."seenAt" < $2::timestamptz
               ) THEN 0.25 ELSE 1 END)
            * (CASE WHEN p."coachUserId" = $1 THEN 0.5 ELSE 1 END) AS score
        ${base}
        ORDER BY score DESC, p."createdAt" DESC, p.id
        LIMIT $3 OFFSET $4`;
    }

    const rows: Array<{ id: string }> = await this.dataSource.query(sql, params);
    const hasMore = rows.length > limit;
    const ids = rows.slice(0, limit).map((r) => r.id);
    return {
      items: await this.hydrate(ids, viewerId),
      nextCursor: hasMore ? encodeCursor({ asOf: cursor.asOf, offset: cursor.offset + limit }) : null,
    };
  }

  /** Posts in the given order, with their coach, counts, the viewer's like/save/follow and the latest comments. */
  private async hydrate(ids: string[], viewerId: string | null): Promise<FeedItem[]> {
    if (!ids.length) return [];
    const posts = await this.dataSource.getRepository(CoachPost).find({ where: ids.map((id) => ({ id })), relations: { coach: true } });
    const coachIds = [...new Set(posts.map((p) => p.coachUserId))];
    const profiles = await this.dataSource.getRepository(CoachProfile).find({ where: coachIds.map((userId) => ({ userId })) });
    const brands: Array<{ userId: string; brandName: string; logoUrl: string | null; verifiedAt: Date | null; tagline: string }> = await this.dataSource.query(
      `SELECT "userId", "brandName", "logoUrl", "verifiedAt", tagline FROM sponsor_profiles WHERE "userId" = ANY($1)`,
      [coachIds],
    );
    const [likes, saves, follows]: Array<Array<{ id: string }>> = viewerId
      ? await Promise.all([
          this.dataSource.query(`SELECT "postId" AS id FROM coach_post_likes WHERE "userId" = $1 AND "postId" = ANY($2)`, [viewerId, ids]),
          this.dataSource.query(`SELECT "postId" AS id FROM coach_post_saves WHERE "userId" = $1 AND "postId" = ANY($2)`, [viewerId, ids]),
          this.dataSource.query(`SELECT "coachUserId" AS id FROM coach_follows WHERE "followerUserId" = $1 AND "coachUserId" = ANY($2)`, [
            viewerId,
            coachIds,
          ]),
        ])
      : [[], [], []];
    const liked = new Set(likes.map((r) => r.id));
    const saved = new Set(saves.map((r) => r.id));
    const followed = new Set(follows.map((r) => r.id));
    // The two latest comments of each post, for the preview under it.
    const comments: Array<CoachPostComment & { userName: string; userDpUrl: string | null }> = await this.dataSource.query(
      `SELECT c.*, u.name AS "userName", u."dpUrl" AS "userDpUrl" FROM (
         SELECT c.*, row_number() OVER (PARTITION BY c."postId" ORDER BY c."createdAt" DESC) AS rn
           FROM coach_post_comments c WHERE c."postId" = ANY($1) AND c."deletedAt" IS NULL) c
       JOIN users u ON u.id = c."userId"
       WHERE c.rn <= 2 ORDER BY c."createdAt" ASC`,
      [ids],
    );

    const byId = new Map(posts.map((p) => [p.id, p]));
    return ids
      .map((id) => byId.get(id))
      .filter((p): p is CoachPost => Boolean(p))
      .map((p) => {
        const profile = profiles.find((pr) => pr.userId === p.coachUserId);
        const brand = p.authorRole === 'sponsor' ? brands.find((b) => b.userId === p.coachUserId) : undefined;
        return {
          id: p.id,
          body: p.body,
          links: p.links,
          media: p.media,
          createdAt: p.createdAt.toISOString(),
          likeCount: p.likeCount,
          commentCount: p.commentCount,
          saveCount: p.saveCount,
          likedByMe: liked.has(p.id),
          savedByMe: saved.has(p.id),
          coach: {
            id: p.coachUserId,
            name: p.coach?.name ?? 'Coach',
            dpUrl: p.coach?.dpUrl ?? null,
            headline: brand ? brand.tagline : (profile?.headline ?? ''),
            specialities: profile?.specialities ?? [],
            followedByMe: followed.has(p.coachUserId),
          },
          author: {
            role: p.authorRole,
            brand: brand ? { name: brand.brandName, logoUrl: brand.logoUrl, verified: Boolean(brand.verifiedAt) } : null,
          },
          comments: comments
            .filter((c) => c.postId === p.id)
            .map((c) => ({
              id: c.id,
              body: c.body,
              createdAt: new Date(c.createdAt).toISOString(),
              user: { id: c.userId, name: c.userName, dpUrl: c.userDpUrl },
              mine: c.userId === viewerId,
            })),
        };
      });
  }

  // ------------------------------------------------------------ interactions

  private async approvedPost(postId: string): Promise<CoachPost> {
    const post = await this.dataSource.getRepository(CoachPost).findOne({ where: { id: postId, deletedAt: IsNull() } });
    if (!post || post.status !== 'approved') throw new NotFoundException('Post not found');
    return post;
  }

  /** The specialities of the coaches whose posts the viewer liked or saved (the "for you" ranking prefers those topics). */
  private async likedSpecialities(userId: string): Promise<string[]> {
    const rows: Array<{ specialities: unknown }> = await this.dataSource.query(
      `SELECT cp2.specialities
         FROM coach_posts p2
         JOIN coach_profiles cp2 ON cp2."userId" = p2."coachUserId"
        WHERE p2.id IN (SELECT "postId" FROM coach_post_likes WHERE "userId" = $1
                        UNION SELECT "postId" FROM coach_post_saves WHERE "userId" = $1)`,
      [userId],
    );
    const specs = new Set<string>();
    for (const row of rows) {
      const list = typeof row.specialities === 'string' ? JSON.parse(row.specialities) : row.specialities;
      if (Array.isArray(list)) for (const s of list) specs.add(String(s));
    }
    return [...specs];
  }

  /** Like / unlike, save / unsave: idempotent, and the post's counter moves only on a real change. */
  async toggle(kind: 'like' | 'save', user: User, postId: string, on: boolean) {
    const post = await this.approvedPost(postId);
    const table = kind === 'like' ? 'coach_post_likes' : 'coach_post_saves';
    const counter = kind === 'like' ? 'likeCount' : 'saveCount';
    const changed = await this.dataSource.transaction(async (em) => {
      // INSERT IGNORE counts 0 rows when the like/save already exists; DELETE counts what it removed.
      const result: { affectedRows?: number } = on
        ? await em.query(`INSERT IGNORE INTO ${table} ("postId", "userId") VALUES ($1, $2)`, [postId, user.id])
        : await em.query(`DELETE FROM ${table} WHERE "postId" = $1 AND "userId" = $2`, [postId, user.id]);
      const n = Number(result?.affectedRows ?? 0);
      if (n) await em.query(`UPDATE coach_posts SET "${counter}" = GREATEST(0, "${counter}" + $2) WHERE id = $1`, [postId, on ? 1 : -1]);
      return n > 0;
    });
    if (changed && on && kind === 'like' && post.coachUserId !== user.id) {
      await this.notify(post.coachUserId, 'coaching.postLiked', 'New like', `${user.name} liked your tutorial.`, { name: user.name });
    }
    const [fresh] = await this.dataSource.query(`SELECT "likeCount", "saveCount" FROM coach_posts WHERE id = $1`, [postId]);
    return { postId, [kind === 'like' ? 'liked' : 'saved']: on, likeCount: fresh.likeCount, saveCount: fresh.saveCount };
  }

  async comments(postId: string, viewerId: string | null, before: string | undefined, rawLimit: number | undefined) {
    await this.approvedPost(postId);
    const limit = Math.min(50, Math.max(1, rawLimit ?? 20));
    const rows: Array<CoachPostComment & { userName: string; userDpUrl: string | null }> = await this.dataSource.query(
      `SELECT c.*, u.name AS "userName", u."dpUrl" AS "userDpUrl"
         FROM coach_post_comments c JOIN users u ON u.id = c."userId"
        WHERE c."postId" = $1 AND c."deletedAt" IS NULL AND ($2::timestamptz IS NULL OR c."createdAt" < $2::timestamptz)
        ORDER BY c."createdAt" DESC LIMIT $3`,
      [postId, before ? new Date(before) : null, limit + 1],
    );
    const page = rows.slice(0, limit).reverse();
    return {
      items: page.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: new Date(c.createdAt).toISOString(),
        user: { id: c.userId, name: c.userName, dpUrl: c.userDpUrl },
        mine: c.userId === viewerId,
      })),
      // Older comments load above the shown ones.
      nextBefore: rows.length > limit ? new Date(page[0].createdAt).toISOString() : null,
    };
  }

  async addComment(user: User, postId: string, body: string): Promise<FeedCommentView> {
    const text = body.trim();
    if (!text) throw new BadRequestException('Write a comment first');
    const post = await this.approvedPost(postId);
    const saved = await this.dataSource.transaction(async (em) => {
      const comment = await em.getRepository(CoachPostComment).save(em.getRepository(CoachPostComment).create({ postId, userId: user.id, body: text }));
      await em.query(`UPDATE coach_posts SET "commentCount" = "commentCount" + 1 WHERE id = $1`, [postId]);
      return comment;
    });
    if (post.coachUserId !== user.id) {
      await this.notify(post.coachUserId, 'coaching.postComment', 'New comment', `${user.name} commented: "${text.slice(0, 80)}"`, {
        name: user.name,
      });
    }
    return {
      id: saved.id,
      body: saved.body,
      createdAt: saved.createdAt.toISOString(),
      user: { id: user.id, name: user.name, dpUrl: user.dpUrl },
      mine: true,
    };
  }

  /** The author, the post's coach or staff can remove a comment. */
  async deleteComment(user: User, commentId: string) {
    const repo = this.dataSource.getRepository(CoachPostComment);
    const comment = await repo.findOne({ where: { id: commentId, deletedAt: IsNull() }, relations: { post: true } });
    if (!comment) throw new NotFoundException('Comment not found');
    const allowed = comment.userId === user.id || comment.post?.coachUserId === user.id || Boolean(user.systemRole);
    if (!allowed) throw new ForbiddenException("You can't delete this comment");
    await this.dataSource.transaction(async (em) => {
      await em.getRepository(CoachPostComment).update({ id: commentId }, { deletedAt: new Date() });
      await em.query(`UPDATE coach_posts SET "commentCount" = GREATEST(0, "commentCount" - 1) WHERE id = $1`, [comment.postId]);
    });
    return { deleted: true };
  }

  /** Follow / unfollow a coach or a sponsor. */
  async follow(user: User, coachUserId: string, on: boolean) {
    if (coachUserId === user.id) throw new BadRequestException("You can't follow yourself");
    const [author]: Array<{ ok: boolean }> = await this.dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM coach_profiles WHERE "userId" = $1) OR EXISTS (SELECT 1 FROM sponsor_profiles WHERE "userId" = $1) AS ok`,
      [coachUserId],
    );
    if (!author?.ok) throw new NotFoundException('Not found');
    const result: { affectedRows?: number } = on
      ? await this.dataSource.query(`INSERT IGNORE INTO coach_follows ("coachUserId", "followerUserId") VALUES ($1, $2)`, [coachUserId, user.id])
      : await this.dataSource.query(`DELETE FROM coach_follows WHERE "coachUserId" = $1 AND "followerUserId" = $2`, [coachUserId, user.id]);
    const changed = Number(result?.affectedRows ?? 0) > 0;
    if (changed && on) await this.notify(coachUserId, 'coaching.followed', 'New follower', `${user.name} follows you now.`, { name: user.name });
    const [{ n }] = await this.dataSource.query(`SELECT count(*)::int AS n FROM coach_follows WHERE "coachUserId" = $1`, [coachUserId]);
    return { coachUserId, following: on, followers: n };
  }

  async followStats(coachUserId: string, viewerId: string | null) {
    const [{ n }] = await this.dataSource.query(`SELECT count(*)::int AS n FROM coach_follows WHERE "coachUserId" = $1`, [coachUserId]);
    const [mine] = viewerId
      ? await this.dataSource.query(`SELECT 1 FROM coach_follows WHERE "coachUserId" = $1 AND "followerUserId" = $2`, [coachUserId, viewerId])
      : [];
    return { followers: n as number, followedByMe: Boolean(mine) };
  }

  /** Posts that scrolled into view (batched by the app); they sink in later feeds. */
  async markSeen(user: User, postIds: string[]) {
    const ids = [...new Set(postIds)].slice(0, 50);
    if (!ids.length) return { seen: 0 };
    await this.dataSource.query(
      `INSERT IGNORE INTO coach_post_views ("postId", "userId")
       SELECT p.id, $2 FROM coach_posts p WHERE p.id = ANY($1)`,
      [ids, user.id],
    );
    return { seen: ids.length };
  }

  private async notify(userId: string, code: string, title: string, message: string, params: Record<string, string>) {
    await this.notificationsService
      .createNotification(userId, { title, message, type: 'coaching', link: '/dashboard/feed', code, params })
      .catch((err) => this.logger.error(`Feed notification failed: ${(err as Error).message}`));
  }
}
