import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { WatchPlayer } from "@/features/watch/components/WatchPlayer";
import { requireProfile } from "@/lib/require-profile";
import { cn } from "@/lib/utils";
import { getSeriesForPlayback, getSeriesProgress } from "@/services/playback.service";

interface WatchSeriesPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ e?: string; auto?: string }>;
}

export const metadata: Metadata = { title: "Assistir série" };

export default async function WatchSeriesPage({
  params,
  searchParams,
}: WatchSeriesPageProps) {
  const [{ slug }, { e: requestedEpisodeId, auto }] = await Promise.all([
    params,
    searchParams,
  ]);
  const profile = await requireProfile();

  const series = await getSeriesForPlayback(slug, profile.isKids);
  if (!series) {
    notFound();
  }

  const progress = await getSeriesProgress(profile.id, series.id);
  const progressByEpisode = new Map(progress.map((row) => [row.episodeId, row]));

  const episodes = series.seasons.flatMap((season) =>
    season.episodes.map((episode) => ({ ...episode, seasonNumber: season.seasonNumber })),
  );
  const playable = episodes.filter((episode) => episode.video);

  // Explicit choice > continue where the profile stopped > first episode with a video.
  const requested = playable.find((episode) => episode.id === requestedEpisodeId);
  const lastWatched = playable.find((episode) => episode.id === progress[0]?.episodeId);
  const lastWatchedIndex = lastWatched ? playable.indexOf(lastWatched) : -1;
  const resumeTarget =
    lastWatched && progress[0]?.completed
      ? (playable[lastWatchedIndex + 1] ?? lastWatched)
      : lastWatched;
  const current = requested ?? resumeTarget ?? playable[0];
  const next = current ? playable[playable.indexOf(current) + 1] : undefined;

  const currentProgress = current ? progressByEpisode.get(current.id) : undefined;
  const resumeAt =
    currentProgress && !currentProgress.completed ? currentProgress.positionInSeconds : 0;

  const episodeHref = (id: string, autoPlay = false) =>
    `/watch/series/${series.slug}?e=${id}${autoPlay ? "&auto=1" : ""}`;

  return (
    <>
      <Header />
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-8">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Voltar
        </Link>

        {current?.video ? (
          <div className="flex flex-col gap-3">
            <WatchPlayer
              key={current.id}
              src={current.video.url}
              mimeType={current.video.mimeType}
              poster={series.backdrop?.url ?? series.poster?.url}
              target={{ kind: "episode", contentId: current.id }}
              resumeAt={resumeAt}
              autoPlay={auto === "1"}
              nextHref={next ? episodeHref(next.id, true) : undefined}
            />
            <p className="text-foreground text-sm font-medium">
              T{current.seasonNumber} · E{current.episodeNumber} — {current.title}
            </p>
            {current.synopsis && (
              <p className="text-muted-foreground max-w-3xl text-sm leading-relaxed">
                {current.synopsis}
              </p>
            )}
          </div>
        ) : (
          <div className="border-border text-muted-foreground flex aspect-video w-full items-center justify-center rounded-lg border text-sm">
            Esta série ainda não tem episódios com vídeo vinculado.
          </div>
        )}

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-foreground text-2xl font-semibold">
            {series.title}{" "}
            <span className="text-muted-foreground text-lg font-normal">
              ({series.releaseYear})
            </span>
          </h1>
          <p className="text-muted-foreground max-w-3xl text-sm leading-relaxed">
            {series.synopsis}
          </p>
        </div>

        {series.seasons.map((season) => (
          <section key={season.id} className="flex flex-col gap-2">
            <h2 className="text-foreground text-lg font-semibold">
              Temporada {season.seasonNumber}
              {season.title ? ` — ${season.title}` : ""}
            </h2>
            <ul className="border-border divide-tint/5 divide-y rounded-md border">
              {season.episodes.map((episode) => {
                const row = progressByEpisode.get(episode.id);
                const status = row?.completed ? "assistido" : row ? "em andamento" : null;
                const label = (
                  <>
                    <span className="text-muted-foreground w-10 shrink-0">
                      E{String(episode.episodeNumber).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{episode.title}</span>
                    {status && (
                      <span className="text-accent shrink-0 text-xs">{status}</span>
                    )}
                    {!episode.video && (
                      <span className="text-muted-foreground shrink-0 text-xs">
                        sem vídeo
                      </span>
                    )}
                  </>
                );

                return (
                  <li key={episode.id}>
                    {episode.video ? (
                      <Link
                        href={episodeHref(episode.id)}
                        className={cn(
                          "text-foreground hover:bg-tint/10 flex items-center gap-3 px-4 py-2.5 text-sm transition-colors",
                          current?.id === episode.id && "bg-accent/20",
                        )}
                      >
                        {label}
                      </Link>
                    ) : (
                      <div className="text-muted-foreground flex items-center gap-3 px-4 py-2.5 text-sm">
                        {label}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
