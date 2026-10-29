-- An uploaded video can be the example for one ad style on the create page.
ALTER TABLE "showcase_videos" ADD COLUMN "style" TEXT;
ALTER TABLE "showcase_videos" ADD COLUMN "in_gallery" BOOLEAN NOT NULL DEFAULT true;
