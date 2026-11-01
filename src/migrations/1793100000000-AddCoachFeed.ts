import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The coaching feed: likes, saves, comments, follows and "seen" marks on coach posts,
 * plus counters on the posts so the feed can rank them quickly.
 */
export class AddCoachFeed1793100000000 implements MigrationInterface {
  name = 'AddCoachFeed1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "coach_posts" ADD "likeCount" int NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "coach_posts" ADD "commentCount" int NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "coach_posts" ADD "saveCount" int NOT NULL DEFAULT 0`);

    for (const table of ['coach_post_likes', 'coach_post_saves']) {
      await queryRunner.query(`
        CREATE TABLE "${table}" (
          "postId" uuid NOT NULL REFERENCES "coach_posts"("id") ON DELETE CASCADE,
          "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "createdAt" timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY ("postId", "userId")
        )`);
      await queryRunner.query(`CREATE INDEX "IDX_${table}_user" ON "${table}" ("userId", "createdAt")`);
    }
    await queryRunner.query(`
      CREATE TABLE "coach_post_views" (
        "postId" uuid NOT NULL REFERENCES "coach_posts"("id") ON DELETE CASCADE,
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "seenAt" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("postId", "userId")
      )`);
    await queryRunner.query(`
      CREATE TABLE "coach_follows" (
        "coachUserId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "followerUserId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("coachUserId", "followerUserId")
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_coach_follows_follower" ON "coach_follows" ("followerUserId")`);
    await queryRunner.query(`
      CREATE TABLE "coach_post_comments" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "postId" uuid NOT NULL REFERENCES "coach_posts"("id") ON DELETE CASCADE,
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "body" text NOT NULL,
        "deletedAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_coach_post_comments_post" ON "coach_post_comments" ("postId", "createdAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_coach_posts_feed" ON "coach_posts" ("status", "createdAt") WHERE "deletedAt" IS NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_coach_posts_feed"`);
    await queryRunner.query(`DROP TABLE "coach_post_comments"`);
    await queryRunner.query(`DROP TABLE "coach_follows"`);
    await queryRunner.query(`DROP TABLE "coach_post_views"`);
    await queryRunner.query(`DROP TABLE "coach_post_saves"`);
    await queryRunner.query(`DROP TABLE "coach_post_likes"`);
    await queryRunner.query(`ALTER TABLE "coach_posts" DROP COLUMN "saveCount"`);
    await queryRunner.query(`ALTER TABLE "coach_posts" DROP COLUMN "commentCount"`);
    await queryRunner.query(`ALTER TABLE "coach_posts" DROP COLUMN "likeCount"`);
  }
}
