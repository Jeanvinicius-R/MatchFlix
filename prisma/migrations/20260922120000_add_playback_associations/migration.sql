-- CreateEnum
CREATE TYPE "AssociationMediaType" AS ENUM ('MOVIE', 'EPISODE');

-- CreateEnum
CREATE TYPE "PlaybackFormat" AS ENUM ('MP4', 'HLS', 'DASH', 'EMBED');

-- CreateEnum
CREATE TYPE "RightsStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AvailabilityStatus" AS ENUM ('UNKNOWN', 'AVAILABLE', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "PlaybackAssociation" (
    "id" UUID NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "mediaType" "AssociationMediaType" NOT NULL,
    "seasonNumber" INTEGER NOT NULL DEFAULT 0,
    "episodeNumber" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL,
    "providerAssetId" TEXT NOT NULL,
    "playbackType" "PlaybackFormat",
    "rightsStatus" "RightsStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "licenseReference" TEXT,
    "availabilityStatus" "AvailabilityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaybackAssociation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaybackAssociation_lookup_idx" ON "PlaybackAssociation"("tmdbId", "mediaType", "seasonNumber", "episodeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybackAssociation_asset_key" ON "PlaybackAssociation"("tmdbId", "mediaType", "seasonNumber", "episodeNumber", "provider", "providerAssetId");
