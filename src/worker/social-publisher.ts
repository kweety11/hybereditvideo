// Social media publisher: posts video content to Instagram, Facebook Reels and
// TikTok via their official APIs. No account creation is performed here — the
// caller supplies long-lived access tokens for accounts they already own.
//
// Reuses the plain `fetch()` pattern already used across the project
// (see scripts/local-ffmpeg-server.js for the fal.ai / GIPHY / OpenAI calls).

const GRAPH = "https://graph.facebook.com/v21.0";
const TIKTOK_API = "https://open.tiktokapis.com/v2";

export type Platform = "instagram" | "facebook" | "tiktok";

/** Subset of the Worker Env containing the social credentials. */
export interface SocialEnv {
  META_PAGE_ACCESS_TOKEN?: string;
  IG_BUSINESS_ID?: string;
  FB_PAGE_ID?: string;
  TIKTOK_ACCESS_TOKEN?: string;
  TIKTOK_PRIVACY_LEVEL?: string; // e.g. SELF_ONLY (sandbox-safe), PUBLIC_TO_EVERYONE
  SOCIAL_DRY_RUN?: string; // "true" => log payloads but do not post
}

export interface PublishInput {
  /** Publicly reachable URL to the rendered video (required by IG & TikTok). */
  videoUrl: string;
  /** Full caption, already including hashtags. */
  caption: string;
}

export interface PublishResult {
  platform: Platform;
  success: boolean;
  platformPostId?: string;
  error?: string;
  dryRun?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isDryRun(env: SocialEnv): boolean {
  return String(env.SOCIAL_DRY_RUN).toLowerCase() === "true";
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

// ---------------------------------------------------------------------------
// Instagram (Graph API) — Reels publishing is a two-step container + publish flow
// ---------------------------------------------------------------------------
async function publishInstagram(
  env: SocialEnv,
  input: PublishInput
): Promise<PublishResult> {
  const igId = env.IG_BUSINESS_ID;
  const token = env.META_PAGE_ACCESS_TOKEN;
  if (!igId || !token) {
    return {
      platform: "instagram",
      success: false,
      error: "Missing IG_BUSINESS_ID or META_PAGE_ACCESS_TOKEN",
    };
  }
  if (isDryRun(env)) {
    return { platform: "instagram", success: true, dryRun: true, platformPostId: "dry-run" };
  }

  try {
    // 1) Create the media container.
    const createRes = await fetch(`${GRAPH}/${igId}/media`, {
      method: "POST",
      body: new URLSearchParams({
        media_type: "REELS",
        video_url: input.videoUrl,
        caption: input.caption,
        access_token: token,
      }),
    });
    const created = await readJson(createRes);
    if (!createRes.ok || !created.id) {
      return { platform: "instagram", success: false, error: created.error?.message || `container failed (${createRes.status})` };
    }
    const containerId = created.id as string;

    // 2) Poll until the container has finished processing.
    for (let i = 0; i < 20; i++) {
      await sleep(3000);
      const statusRes = await fetch(
        `${GRAPH}/${containerId}?fields=status_code&access_token=${encodeURIComponent(token)}`
      );
      const status = await readJson(statusRes);
      if (status.status_code === "FINISHED") break;
      if (status.status_code === "ERROR") {
        return { platform: "instagram", success: false, error: "Media processing failed on Instagram" };
      }
    }

    // 3) Publish the container.
    const publishRes = await fetch(`${GRAPH}/${igId}/media_publish`, {
      method: "POST",
      body: new URLSearchParams({ creation_id: containerId, access_token: token }),
    });
    const published = await readJson(publishRes);
    if (!publishRes.ok || !published.id) {
      return { platform: "instagram", success: false, error: published.error?.message || `publish failed (${publishRes.status})` };
    }
    return { platform: "instagram", success: true, platformPostId: published.id };
  } catch (error) {
    return { platform: "instagram", success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Facebook Reels — 3-phase hosted upload (start -> upload by file_url -> finish)
// ---------------------------------------------------------------------------
async function publishFacebook(
  env: SocialEnv,
  input: PublishInput
): Promise<PublishResult> {
  const pageId = env.FB_PAGE_ID;
  const token = env.META_PAGE_ACCESS_TOKEN;
  if (!pageId || !token) {
    return {
      platform: "facebook",
      success: false,
      error: "Missing FB_PAGE_ID or META_PAGE_ACCESS_TOKEN",
    };
  }
  if (isDryRun(env)) {
    return { platform: "facebook", success: true, dryRun: true, platformPostId: "dry-run" };
  }

  try {
    // 1) Start an upload session.
    const startRes = await fetch(`${GRAPH}/${pageId}/video_reels`, {
      method: "POST",
      body: new URLSearchParams({ upload_phase: "start", access_token: token }),
    });
    const start = await readJson(startRes);
    if (!startRes.ok || !start.video_id || !start.upload_url) {
      return { platform: "facebook", success: false, error: start.error?.message || `start failed (${startRes.status})` };
    }

    // 2) Tell the upload endpoint to pull the hosted file.
    const uploadRes = await fetch(start.upload_url, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, file_url: input.videoUrl },
    });
    const upload = await readJson(uploadRes);
    if (!uploadRes.ok || upload.success === false) {
      return { platform: "facebook", success: false, error: upload.error?.message || `upload failed (${uploadRes.status})` };
    }

    // 3) Finish and publish.
    const finishRes = await fetch(`${GRAPH}/${pageId}/video_reels`, {
      method: "POST",
      body: new URLSearchParams({
        upload_phase: "finish",
        video_id: start.video_id,
        video_state: "PUBLISHED",
        description: input.caption,
        access_token: token,
      }),
    });
    const finish = await readJson(finishRes);
    if (!finishRes.ok || finish.success === false) {
      return { platform: "facebook", success: false, error: finish.error?.message || `finish failed (${finishRes.status})` };
    }
    return { platform: "facebook", success: true, platformPostId: start.video_id };
  } catch (error) {
    return { platform: "facebook", success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// TikTok (Content Posting API v2) — PULL_FROM_URL flow
// ---------------------------------------------------------------------------
async function publishTikTok(
  env: SocialEnv,
  input: PublishInput
): Promise<PublishResult> {
  const token = env.TIKTOK_ACCESS_TOKEN;
  if (!token) {
    return { platform: "tiktok", success: false, error: "Missing TIKTOK_ACCESS_TOKEN" };
  }
  if (isDryRun(env)) {
    return { platform: "tiktok", success: true, dryRun: true, platformPostId: "dry-run" };
  }

  try {
    const res = await fetch(`${TIKTOK_API}/post/publish/video/init/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title: input.caption.slice(0, 2200),
          // SELF_ONLY is required while the app is unaudited (sandbox).
          privacy_level: env.TIKTOK_PRIVACY_LEVEL || "SELF_ONLY",
          disable_comment: false,
          disable_duet: false,
          disable_stitch: false,
        },
        source_info: { source: "PULL_FROM_URL", video_url: input.videoUrl },
      }),
    });
    const json = await readJson(res);
    const publishId = json.data?.publish_id;
    if (!res.ok || json.error?.code !== "ok" || !publishId) {
      return { platform: "tiktok", success: false, error: json.error?.message || `init failed (${res.status})` };
    }
    return { platform: "tiktok", success: true, platformPostId: publishId };
  } catch (error) {
    return { platform: "tiktok", success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

const PUBLISHERS: Record<Platform, (env: SocialEnv, input: PublishInput) => Promise<PublishResult>> = {
  instagram: publishInstagram,
  facebook: publishFacebook,
  tiktok: publishTikTok,
};

/** Publish a single piece of content to the requested platforms. */
export async function publishToPlatforms(
  env: SocialEnv,
  platforms: Platform[],
  input: PublishInput
): Promise<PublishResult[]> {
  const results: PublishResult[] = [];
  for (const platform of platforms) {
    const publisher = PUBLISHERS[platform];
    if (!publisher) {
      results.push({ platform, success: false, error: `Unsupported platform: ${platform}` });
      continue;
    }
    results.push(await publisher(env, input));
  }
  return results;
}

export interface ConnectionStatus {
  platform: Platform;
  configured: boolean;
  ok: boolean;
  detail?: string;
}

/** Lightweight credential check for each platform (read-only calls). */
export async function testConnections(env: SocialEnv): Promise<ConnectionStatus[]> {
  const out: ConnectionStatus[] = [];

  // Instagram
  {
    const configured = Boolean(env.IG_BUSINESS_ID && env.META_PAGE_ACCESS_TOKEN);
    let ok = false;
    let detail: string | undefined;
    if (configured) {
      try {
        const res = await fetch(
          `${GRAPH}/${env.IG_BUSINESS_ID}?fields=username&access_token=${encodeURIComponent(env.META_PAGE_ACCESS_TOKEN!)}`
        );
        const json = await readJson(res);
        ok = res.ok && Boolean(json.username);
        detail = ok ? `@${json.username}` : json.error?.message || `HTTP ${res.status}`;
      } catch (e) {
        detail = e instanceof Error ? e.message : "request failed";
      }
    } else {
      detail = "Missing IG_BUSINESS_ID or META_PAGE_ACCESS_TOKEN";
    }
    out.push({ platform: "instagram", configured, ok, detail });
  }

  // Facebook
  {
    const configured = Boolean(env.FB_PAGE_ID && env.META_PAGE_ACCESS_TOKEN);
    let ok = false;
    let detail: string | undefined;
    if (configured) {
      try {
        const res = await fetch(
          `${GRAPH}/${env.FB_PAGE_ID}?fields=name&access_token=${encodeURIComponent(env.META_PAGE_ACCESS_TOKEN!)}`
        );
        const json = await readJson(res);
        ok = res.ok && Boolean(json.name);
        detail = ok ? json.name : json.error?.message || `HTTP ${res.status}`;
      } catch (e) {
        detail = e instanceof Error ? e.message : "request failed";
      }
    } else {
      detail = "Missing FB_PAGE_ID or META_PAGE_ACCESS_TOKEN";
    }
    out.push({ platform: "facebook", configured, ok, detail });
  }

  // TikTok
  {
    const configured = Boolean(env.TIKTOK_ACCESS_TOKEN);
    let ok = false;
    let detail: string | undefined;
    if (configured) {
      try {
        const res = await fetch(`${TIKTOK_API}/user/info/?fields=open_id,display_name`, {
          headers: { Authorization: `Bearer ${env.TIKTOK_ACCESS_TOKEN}` },
        });
        const json = await readJson(res);
        ok = res.ok && Boolean(json.data?.user?.open_id);
        detail = ok ? json.data.user.display_name || "connected" : json.error?.message || `HTTP ${res.status}`;
      } catch (e) {
        detail = e instanceof Error ? e.message : "request failed";
      }
    } else {
      detail = "Missing TIKTOK_ACCESS_TOKEN";
    }
    out.push({ platform: "tiktok", configured, ok, detail });
  }

  return out;
}
