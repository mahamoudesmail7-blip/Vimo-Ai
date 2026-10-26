-- Landing page gallery: an admin marks finished videos to show publicly.
ALTER TABLE "video_jobs" ADD COLUMN "showcase" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "video_jobs_showcase_idx" ON "video_jobs"("showcase");
