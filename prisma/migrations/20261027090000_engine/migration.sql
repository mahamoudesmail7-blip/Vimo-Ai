-- Multi-provider engine. Additive only: existing rows keep working.
ALTER TABLE "video_jobs" ADD COLUMN "provider" TEXT;
ALTER TABLE "video_jobs" ADD COLUMN "plan_json" TEXT;
ALTER TABLE "video_jobs" ADD COLUMN "options_json" TEXT;
ALTER TABLE "video_jobs" ADD COLUMN "extra_image_keys" TEXT;
ALTER TABLE "video_jobs" ADD COLUMN "audio_json" TEXT;
ALTER TABLE "video_jobs" ADD COLUMN "cost_estimate_usd" DOUBLE PRECISION;
ALTER TABLE "video_jobs" ADD COLUMN "cost_actual_usd" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "video_jobs" ADD COLUMN "client_ref" TEXT;
CREATE UNIQUE INDEX "video_jobs_client_ref_key" ON "video_jobs"("client_ref");

CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "engine_events" (
    "id" SERIAL NOT NULL,
    "job_id" INTEGER,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "kind" TEXT NOT NULL,
    "usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "engine_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "engine_events_provider_kind_created_at_idx" ON "engine_events"("provider", "kind", "created_at");
CREATE INDEX "engine_events_created_at_idx" ON "engine_events"("created_at");
