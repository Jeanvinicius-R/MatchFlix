-- AlterTable
ALTER TABLE "Movie" ADD COLUMN     "tmdbId" INTEGER;

-- AlterTable
ALTER TABLE "Series" ADD COLUMN     "tmdbId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Movie_tmdbId_key" ON "Movie"("tmdbId");

-- CreateIndex
CREATE UNIQUE INDEX "Series_tmdbId_key" ON "Series"("tmdbId");

