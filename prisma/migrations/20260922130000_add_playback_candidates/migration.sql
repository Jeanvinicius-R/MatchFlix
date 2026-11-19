-- CreateEnum
CREATE TYPE "MatchMethod" AS ENUM ('TMDB_ID', 'IMDB_ID', 'METADATA');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "PlaybackCandidate" (
    "id" UUID NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "mediaType" "AssociationMediaType" NOT NULL,
    "seasonNumber" INTEGER NOT NULL DEFAULT 0,
    "episodeNumber" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL,
    "providerAssetId" TEXT NOT NULL,
    "providerTitle" TEXT NOT NULL,
    "providerYear" INTEGER,
    "matchMethod" "MatchMethod" NOT NULL,
    "score" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "PlaybackCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaybackCandidate_review_idx" ON "PlaybackCandidate"("status", "score");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybackCandidate_asset_key" ON "PlaybackCandidate"("tmdbId", "mediaType", "seasonNumber", "episodeNumber", "provider", "providerAssetId");
