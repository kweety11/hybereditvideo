// Scheduling layer for social posts. Stores queued posts in D1 and publishes
// the ones that are due. Invoked both by the cron `scheduled` handler and by
// the manual "publish now" endpoint.

import {
  publishToPlatforms,
  type Platform,
  type PublishResult,
  type SocialEnv,
} from "./social-publisher";

export interface SchedulerEnv extends SocialEnv {
  DB: D1Database;
}

export interface ScheduledPostInput {
  caption: string;
  hashtags?: string[];
  videoUrl: string;
  platforms: Platform[];
  /** Unix epoch in ms. Defaults to now (publish on next cron tick). */
  scheduledAt?: number;
}

export interface ScheduledPostRow {
  id: string;
  caption: string;
  hashtags: string; // JSON array
  videoUrl: string;
  platforms: string; // JSON array
  scheduledAt: number;
  status: string; // pending | published | partial | failed
  results: string | null; // JSON array of PublishResult
  error: string | null;
  createdAt: number;
  publishedAt: number | null;
}

export async function ensureSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS scheduled_posts (
        id TEXT PRIMARY KEY,
        caption TEXT NOT NULL,
        hashtags TEXT NOT NULL DEFAULT '[]',
        videoUrl TEXT NOT NULL,
        platforms TEXT NOT NULL DEFAULT '[]',
        scheduledAt INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        results TEXT,
        error TEXT,
        createdAt INTEGER NOT NULL,
        publishedAt INTEGER
      )`
    )
    .run();
}

/** Build the final caption that gets sent to the platforms. */
function buildCaption(caption: string, hashtags: string[]): string {
  const tags = hashtags.filter(Boolean).join(" ");
  return tags ? `${caption}\n\n${tags}` : caption;
}

export async function insertPosts(
  db: D1Database,
  posts: ScheduledPostInput[]
): Promise<string[]> {
  await ensureSchema(db);
  const now = Date.now();
  const ids: string[] = [];
  for (const post of posts) {
    const id = crypto.randomUUID();
    ids.push(id);
    await db
      .prepare(
        `INSERT INTO scheduled_posts
          (id, caption, hashtags, videoUrl, platforms, scheduledAt, status, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .bind(
        id,
        post.caption,
        JSON.stringify(post.hashtags || []),
        post.videoUrl,
        JSON.stringify(post.platforms || []),
        post.scheduledAt ?? now,
        now
      )
      .run();
  }
  return ids;
}

function parseRow(row: ScheduledPostRow) {
  return {
    ...row,
    hashtags: safeParse<string[]>(row.hashtags, []),
    platforms: safeParse<Platform[]>(row.platforms, []),
    results: row.results ? safeParse<PublishResult[]>(row.results, []) : null,
  };
}

function safeParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function listPosts(db: D1Database) {
  await ensureSchema(db);
  const { results } = await db
    .prepare(`SELECT * FROM scheduled_posts ORDER BY scheduledAt DESC LIMIT 200`)
    .all<ScheduledPostRow>();
  return results.map(parseRow);
}

/** Publish one stored row and persist the outcome. */
async function publishRow(env: SchedulerEnv, row: ScheduledPostRow) {
  const platforms = safeParse<Platform[]>(row.platforms, []);
  const hashtags = safeParse<string[]>(row.hashtags, []);
  const caption = buildCaption(row.caption, hashtags);

  const results = await publishToPlatforms(env, platforms, {
    videoUrl: row.videoUrl,
    caption,
  });

  const successCount = results.filter((r) => r.success).length;
  const status =
    successCount === results.length && results.length > 0
      ? "published"
      : successCount > 0
        ? "partial"
        : "failed";
  const error = results
    .filter((r) => !r.success)
    .map((r) => `${r.platform}: ${r.error}`)
    .join("; ");

  await env.DB.prepare(
    `UPDATE scheduled_posts SET status = ?, results = ?, error = ?, publishedAt = ? WHERE id = ?`
  )
    .bind(status, JSON.stringify(results), error || null, Date.now(), row.id)
    .run();

  return { id: row.id, status, results };
}

/** Cron entry point: publish every pending post whose time has come. */
export async function processDuePosts(env: SchedulerEnv) {
  await ensureSchema(env.DB);
  const now = Date.now();
  const { results: due } = await env.DB.prepare(
    `SELECT * FROM scheduled_posts WHERE status = 'pending' AND scheduledAt <= ? ORDER BY scheduledAt ASC LIMIT 25`
  )
    .bind(now)
    .all<ScheduledPostRow>();

  const processed = [];
  for (const row of due) {
    processed.push(await publishRow(env, row));
  }
  return { processed: processed.length, details: processed };
}

/** Publish a single stored post immediately (used by /publish-now). */
export async function publishNow(env: SchedulerEnv, postId: string) {
  await ensureSchema(env.DB);
  const row = await env.DB.prepare(`SELECT * FROM scheduled_posts WHERE id = ?`)
    .bind(postId)
    .first<ScheduledPostRow>();
  if (!row) return null;
  return publishRow(env, row);
}
