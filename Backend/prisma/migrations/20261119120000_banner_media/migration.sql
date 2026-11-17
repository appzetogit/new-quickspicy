-- Home promotion banners can be an animated GIF or a video.
ALTER TABLE "food_home_promotion_banners"
  ADD COLUMN IF NOT EXISTS "mediaType" VARCHAR(8) NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS "videoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "videoPath" TEXT;
