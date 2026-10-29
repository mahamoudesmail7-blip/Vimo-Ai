-- Landing page gallery: videos the admin uploads directly.
CREATE TABLE "showcase_videos" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "video_key" TEXT NOT NULL,
    "aspect_ratio" TEXT NOT NULL DEFAULT '9:16',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "showcase_videos_pkey" PRIMARY KEY ("id")
);
