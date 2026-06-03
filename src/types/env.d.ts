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
