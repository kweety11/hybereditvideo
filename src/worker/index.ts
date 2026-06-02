import { Hono } from "hono";
import { cors } from "hono/cors";
import { GoogleGenAI } from "@google/genai";
import { testConnections, type Platform } from "./social-publisher";
import {
  insertPosts,
  listPosts,
  processDuePosts,
  publishNow,
  type ScheduledPostInput,
} from "./scheduler";
import socialSeries from "../../content/social-series.json";

interface Env {
  GEMINI_API_KEY: string;
  R2_BUCKET: R2Bucket;
  DB: D1Database;
  MOCHA_USERS_SERVICE_API_URL: string;
  MOCHA_USERS_SERVICE_API_KEY: string;
  // Social publishing credentials (see .dev.vars.example)
  META_PAGE_ACCESS_TOKEN?: string;
  IG_BUSINESS_ID?: string;
  FB_PAGE_ID?: string;
  TIKTOK_ACCESS_TOKEN?: string;
  TIKTOK_PRIVACY_LEVEL?: string;
  SOCIAL_DRY_RUN?: string;
}

// In-memory store for pending requests (dev only)
const pendingRequests = new Map<string, { status: string; result?: any; error?: string }>();

const app = new Hono<{ Bindings: Env }>();

app.use("/*", cors());

// Start an AI edit job - returns immediately with a job ID
app.post("/api/ai-edit/start", async (c) => {
  try {
    const body = await c.req.json();
    const prompt = body.prompt;

    if (!prompt) {
      return c.json({ error: "Prompt is required" }, 400);
    }

    const jobId = crypto.randomUUID();
    pendingRequests.set(jobId, { status: "processing" });

    // Process in background using waitUntil
    c.executionCtx.waitUntil(
      (async () => {
        try {
          const ai = new GoogleGenAI({
            apiKey: c.env.GEMINI_API_KEY,
          });

          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
              systemInstruction: `You are a video editing AI assistant that helps users edit their videos using FFmpeg commands.

When the user describes what they want to do with their video, you should:
1. Understand the editing request
2. Generate the appropriate FFmpeg command to accomplish it
3. Explain what the command will do in simple terms

IMPORTANT: Always use "input.mp4" as the input filename and "output.mp4" as the output filename in your commands.

Return your response as valid JSON with exactly this structure:
{"command": "the FFmpeg command", "explanation": "simple explanation"}

Common video editing tasks:
- Remove dead air/silence (removes silent audio AND corresponding video): ffmpeg -y -i input.mp4 -af "silenceremove=start_periods=1:start_duration=0.5:start_threshold=-40dB:stop_periods=-1:stop_duration=0.5:stop_threshold=-40dB,asetpts=N/SR/TB" -vf "setpts=N/FRAME_RATE/TB" -shortest output.mp4
- Trim/cut video from start to end time: ffmpeg -y -i input.mp4 -ss 00:00:10 -to 00:00:30 -c copy output.mp4
- Speed up 1.5x: ffmpeg -y -i input.mp4 -filter:v "setpts=0.667*PTS" -filter:a "atempo=1.5" output.mp4
- Speed up 2x: ffmpeg -y -i input.mp4 -filter:v "setpts=0.5*PTS" -filter:a "atempo=2.0" output.mp4
- Slow down 0.5x: ffmpeg -y -i input.mp4 -filter:v "setpts=2.0*PTS" -filter:a "atempo=0.5" output.mp4
- Remove audio completely: ffmpeg -y -i input.mp4 -an -c:v copy output.mp4
- Remove background noise from audio: ffmpeg -y -i input.mp4 -af "highpass=f=200,lowpass=f=3000,afftdn=nf=-25" -c:v copy output.mp4
- Resize to 1280x720: ffmpeg -y -i input.mp4 -vf "scale=1280:720" output.mp4
- Resize to 1920x1080: ffmpeg -y -i input.mp4 -vf "scale=1920:1080" output.mp4
- Crop center 640x480: ffmpeg -y -i input.mp4 -vf "crop=640:480" output.mp4
- Rotate 90° clockwise: ffmpeg -y -i input.mp4 -vf "transpose=1" output.mp4
- Rotate 90° counter-clockwise: ffmpeg -y -i input.mp4 -vf "transpose=2" output.mp4
- Increase volume 50%: ffmpeg -y -i input.mp4 -af "volume=1.5" -c:v copy output.mp4
- Decrease volume 50%: ffmpeg -y -i input.mp4 -af "volume=0.5" -c:v copy output.mp4
- Add fade in/out (1 second): ffmpeg -y -i input.mp4 -vf "fade=t=in:st=0:d=1,fade=t=out:st=END-1:d=1" -af "afade=t=in:st=0:d=1,afade=t=out:st=END-1:d=1" output.mp4
- Extract first 30 seconds: ffmpeg -y -i input.mp4 -t 30 -c copy output.mp4
- Remove first 10 seconds: ffmpeg -y -i input.mp4 -ss 10 -c copy output.mp4
- Convert to MP4 (re-encode): ffmpeg -y -i input.mp4 -c:v libx264 -c:a aac output.mp4

Always use -y flag to overwrite output. Provide safe, valid FFmpeg commands.`,
              responseMimeType: "application/json",
            },
          });

          const responseText = response.text || "{}";
          let result;
          try {
            result = JSON.parse(responseText);
          } catch {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            result = jsonMatch
              ? JSON.parse(jsonMatch[0])
              : { command: "", explanation: "Failed to parse response" };
          }

          pendingRequests.set(jobId, { status: "complete", result });
        } catch (error) {
          console.error("AI edit error:", error);
          pendingRequests.set(jobId, {
            status: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      })()
    );

    return c.json({ jobId, status: "processing" });
  } catch (error) {
    console.error("Start job error:", error);
    return c.json({ error: "Failed to start job" }, 500);
  }
});

// Check job status
app.get("/api/ai-edit/status/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  const job = pendingRequests.get(jobId);

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  if (job.status === "complete") {
    pendingRequests.delete(jobId); // Clean up
    return c.json({ status: "complete", success: true, ...job.result });
  }

  if (job.status === "error") {
    pendingRequests.delete(jobId); // Clean up
    return c.json({ status: "error", error: job.error });
  }

  return c.json({ status: "processing" });
});

// Legacy endpoint - simple synchronous call (fallback)
app.post("/api/ai-edit", async (c) => {
  try {
    const body = await c.req.json();
    const prompt = body.prompt;

    if (!prompt) {
      return c.json({ error: "Prompt is required" }, 400);
    }

    const ai = new GoogleGenAI({
      apiKey: c.env.GEMINI_API_KEY,
    });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: `You are a video editing AI assistant that helps users edit their videos using FFmpeg commands.

When the user describes what they want to do with their video, you should:
1. Understand the editing request
2. Generate the appropriate FFmpeg command to accomplish it
3. Explain what the command will do in simple terms

IMPORTANT: Always use "input.mp4" as the input filename and "output.mp4" as the output filename in your commands.

Return your response as valid JSON with exactly this structure:
{"command": "the FFmpeg command", "explanation": "simple explanation"}

Common video editing tasks:
- Remove dead air/silence: ffmpeg -y -i input.mp4 -af "silenceremove=start_periods=1:start_duration=0.5:start_threshold=-40dB:stop_periods=-1:stop_duration=0.5:stop_threshold=-40dB,asetpts=N/SR/TB" -vf "setpts=N/FRAME_RATE/TB" -shortest output.mp4
- Trim/cut: ffmpeg -y -i input.mp4 -ss 00:00:10 -to 00:00:30 -c copy output.mp4
- Speed up 2x: ffmpeg -y -i input.mp4 -filter:v "setpts=0.5*PTS" -filter:a "atempo=2.0" output.mp4
- Remove background noise: ffmpeg -y -i input.mp4 -af "highpass=f=200,lowpass=f=3000,afftdn=nf=-25" -c:v copy output.mp4
- Resize: ffmpeg -y -i input.mp4 -vf "scale=1280:720" output.mp4

Always use -y flag to overwrite output. Provide safe, valid FFmpeg commands.`,
        responseMimeType: "application/json",
      },
    });

    const responseText = response.text || "{}";
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      result = jsonMatch
        ? JSON.parse(jsonMatch[0])
        : { command: "", explanation: "Failed to parse response" };
    }

    return c.json({ success: true, ...result });
  } catch (error) {
    console.error("AI edit error:", error);
    return c.json(
      {
        error: "Failed to process AI request",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// ---------------------------------------------------------------------------
// Social media auto-posting & scheduling
// ---------------------------------------------------------------------------

// Verify the configured credentials for each platform (read-only).
app.post("/api/social/test-connection", async (c) => {
  const statuses = await testConnections(c.env);
  return c.json({ success: true, platforms: statuses });
});

// Return the bundled content series (movie-review countdown episodes).
app.get("/api/social/series", (c) => {
  return c.json({ success: true, series: socialSeries });
});

// Queue one or more posts for publishing.
app.post("/api/social/schedule", async (c) => {
  try {
    const body = await c.req.json();
    const rawPosts = Array.isArray(body.posts) ? body.posts : body.post ? [body.post] : [];
    if (rawPosts.length === 0) {
      return c.json({ error: "Provide `post` or `posts`" }, 400);
    }

    const posts: ScheduledPostInput[] = [];
    for (const p of rawPosts) {
      if (!p?.videoUrl || !p?.caption || !Array.isArray(p?.platforms) || p.platforms.length === 0) {
        return c.json({ error: "Each post needs caption, videoUrl and a non-empty platforms array" }, 400);
      }
      posts.push({
        caption: String(p.caption),
        hashtags: Array.isArray(p.hashtags) ? p.hashtags.map(String) : [],
        videoUrl: String(p.videoUrl),
        platforms: p.platforms as Platform[],
        scheduledAt: typeof p.scheduledAt === "number" ? p.scheduledAt : undefined,
      });
    }

    const ids = await insertPosts(c.env.DB, posts);
    return c.json({ success: true, scheduled: ids });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to schedule" }, 500);
  }
});

// List all queued / published posts and their status.
app.get("/api/social/jobs", async (c) => {
  const posts = await listPosts(c.env.DB);
  return c.json({ success: true, posts });
});

// Publish a stored post right now (used for testing).
app.post("/api/social/publish-now", async (c) => {
  try {
    const body = await c.req.json();
    if (!body?.postId) {
      return c.json({ error: "postId is required" }, 400);
    }
    const result = await publishNow(c.env, String(body.postId));
    if (!result) {
      return c.json({ error: "Post not found" }, 404);
    }
    return c.json({ success: true, ...result });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Failed to publish" }, 500);
  }
});

export default {
  fetch: app.fetch,
  // Cron trigger: publish every pending post whose scheduled time has passed.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(processDuePosts(env));
  },
} satisfies ExportedHandler<Env>;
