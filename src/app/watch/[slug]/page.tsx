import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/layout/Header";
import MoviePlayback from "@/components/playback/MoviePlayback";
import { FavoriteButton } from "@/features/favorites/components/FavoriteButton";
import { MissingVideoNotice } from "@/features/watch/components/MissingVideoNotice";
import { WatchPlayer } from "@/features/watch/components/WatchPlayer";
import { auth } from "@/lib/auth";
import { requireProfile } from "@/lib/require-profile";
import { isInMyList } from "@/services/favorite.service";
import { getMovieForPlayback } from "@/services/movie.service";
import { getMovieResumePosition } from "@/services/playback.service";

interface WatchPageProps {
  params: Promise<{ slug: string }>;
}

export const metadata: Metadata = { title: "Assistir" };

export default async function WatchPage({ params }: WatchPageProps) {
  const { slug } = await params;
  const profile = await requireProfile(`/watch/${slug}`);
  const isAdmin = (await auth())?.user?.role === "ADMIN";

  const movie = await getMovieForPlayback(slug, profile.isKids);
  if (!movie) {
    notFound();
  }

  const inMyList = await isInMyList(profile.id, { kind: "movie", contentId: movie.id });
  const resumeAt = movie.video ? await getMovieResumePosition(profile.id, movie.id) : 0;

  return (
    <>
      <Header />
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pt-28 pb-8 sm:px-8 md:pt-24">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Voltar
        </Link>

        {movie.video ? (
          <WatchPlayer
            src={movie.video.url}
            mimeType={movie.video.mimeType}
            poster={movie.backdrop?.url ?? movie.poster?.url}
            target={{ kind: "movie", contentId: movie.id }}
            resumeAt={resumeAt}
          />
        ) : movie.tmdbId ? (
          <MoviePlayback tmdbId={movie.tmdbId} />
        ) : (
          <MissingVideoNotice
            noun="filme"
            adminEditHref={isAdmin ? `/admin/movies/${movie.id}/edit` : undefined}
          />
        )}

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-foreground text-2xl font-semibold">
            {movie.title}{" "}
            <span className="text-muted-foreground text-lg font-normal">
              ({movie.releaseYear})
            </span>
          </h1>
          <p className="text-muted-foreground max-w-3xl text-sm leading-relaxed">
            {movie.synopsis}
          </p>
          <div className="mt-2">
            <FavoriteButton
              kind="movie"
              contentId={movie.id}
              initialIsFavorite={inMyList}
            />
          </div>
        </div>
      </main>
    </>
  );
}
