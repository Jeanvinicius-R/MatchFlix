"use client";

import { useState } from "react";
import {
  assignEpisodeVideosAction,
  removeEpisodeVideoAction,
} from "@/app/admin/series/actions";
import { Button } from "@/components/ui/Button";
import {
  VideoSourcePicker,
  type PickedVideoSource,
  type VideoSourceProviderOption,
} from "@/features/admin/components/VideoSourcePicker";
import { cn } from "@/lib/utils";

interface EpisodeRow {
  id: string;
  episodeNumber: number;
  title: string;
  video: { fileName: string | null } | null;
}

interface SeasonRow {
  id: string;
  seasonNumber: number;
  title: string | null;
  episodes: EpisodeRow[];
}

interface SeriesEpisodesSectionProps {
  seriesId: string;
  seriesTitle: string;
  providers: VideoSourceProviderOption[];
  seasons: SeasonRow[];
}

const NO_FILE = "";

/**
 * Episodes without a video get the item's files in order (ep1 -> file 1, ...);
 * episodes that already have one are left alone unless the admin changes them.
 */
function buildDefaultMapping(
  episodes: EpisodeRow[],
  files: PickedVideoSource["files"],
): Record<string, string> {
  const mapping: Record<string, string> = {};
  let nextFile = 0;
  for (const episode of episodes) {
    if (episode.video) {
      mapping[episode.id] = NO_FILE;
    } else {
      mapping[episode.id] = files[nextFile]?.fileName ?? NO_FILE;
      nextFile += 1;
    }
  }
  return mapping;
}

function SeasonPanel({
  seriesId,
  seriesTitle,
  providers,
  season,
}: {
  seriesId: string;
  seriesTitle: string;
  providers: VideoSourceProviderOption[];
  season: SeasonRow;
}) {
  const [picked, setPicked] = useState<PickedVideoSource | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const withVideo = season.episodes.filter((episode) => episode.video).length;
  const assignmentCount = Object.values(mapping).filter(Boolean).length;

  function handlePick(next: PickedVideoSource | null) {
    setPicked(next);
    setMapping(next ? buildDefaultMapping(season.episodes, next.files) : {});
    setMessage(null);
  }

  async function handleSave() {
    if (!picked) {
      return;
    }
    setIsBusy(true);
    setMessage(null);

    const result = await assignEpisodeVideosAction(seriesId, {
      provider: picked.providerId,
      itemId: picked.itemId,
      assignments: Object.entries(mapping)
        .filter(([, fileName]) => fileName)
        .map(([episodeId, fileName]) => ({ episodeId, fileName })),
    });
    setIsBusy(false);

    const firstFieldError = result.fieldErrors
      ? Object.values(result.fieldErrors)[0]?.[0]
      : undefined;
    const error = result.formError ?? firstFieldError;
    if (error) {
      setMessage({ text: error, isError: true });
      return;
    }
    setMessage({
      text: `${result.savedCount} episódio(s) vinculado(s).`,
      isError: false,
    });
    setPicked(null);
    setMapping({});
  }

  async function handleRemove(episodeId: string) {
    setIsBusy(true);
    setMessage(null);
    await removeEpisodeVideoAction(seriesId, episodeId);
    setIsBusy(false);
  }

  return (
    <details className="border-border rounded-md border">
      <summary className="text-foreground cursor-pointer px-4 py-3 text-sm font-medium">
        Temporada {season.seasonNumber}
        {season.title ? ` — ${season.title}` : ""}
        <span className="text-muted-foreground font-normal">
          {" "}
          · {withVideo}/{season.episodes.length} com vídeo
        </span>
      </summary>

      <div className="border-border flex flex-col gap-4 border-t p-4">
        <VideoSourcePicker
          providers={providers}
          initialQuery={seriesTitle}
          forEpisodes
          onPick={handlePick}
        />

        <ul className="divide-tint/5 flex flex-col divide-y">
          {season.episodes.map((episode) => (
            <li
              key={episode.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2 text-sm"
            >
              <span className="text-foreground min-w-0 flex-1">
                <span className="text-muted-foreground">
                  E{String(episode.episodeNumber).padStart(2, "0")}
                </span>{" "}
                {episode.title}
              </span>

              {picked ? (
                <select
                  aria-label={`Arquivo do episódio ${episode.episodeNumber}`}
                  value={mapping[episode.id] ?? NO_FILE}
                  onChange={(event) =>
                    setMapping((current) => ({
                      ...current,
                      [episode.id]: event.target.value,
                    }))
                  }
                  className="border-border text-foreground bg-background max-w-full rounded-md border px-2 py-1 text-xs sm:max-w-xs"
                >
                  <option value={NO_FILE}>
                    {episode.video ? "Manter atual" : "Sem vídeo"}
                  </option>
                  {picked.files.map((file) => (
                    <option key={file.fileName} value={file.fileName}>
                      {file.fileName}
                    </option>
                  ))}
                </select>
              ) : (
                <span
                  className={cn(
                    "text-xs",
                    episode.video ? "text-accent" : "text-muted-foreground",
                  )}
                >
                  {episode.video ? (episode.video.fileName ?? "com vídeo") : "sem vídeo"}
                </span>
              )}

              {!picked && episode.video && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleRemove(episode.id)}
                  className="text-muted-foreground hover:text-danger text-xs underline disabled:opacity-50"
                >
                  Remover
                </button>
              )}
            </li>
          ))}
        </ul>

        {message && (
          <p
            role={message.isError ? "alert" : "status"}
            className={cn("text-sm", message.isError ? "text-danger" : "text-accent")}
          >
            {message.text}
          </p>
        )}

        {picked && (
          <Button
            type="button"
            onClick={handleSave}
            disabled={isBusy || assignmentCount === 0}
            className="w-full sm:w-auto"
          >
            {isBusy ? "Aguarde..." : `Vincular ${assignmentCount} episódio(s)`}
          </Button>
        )}
      </div>
    </details>
  );
}

export function SeriesEpisodesSection({
  seriesId,
  seriesTitle,
  providers,
  seasons,
}: SeriesEpisodesSectionProps) {
  return (
    <section className="border-border flex flex-col gap-4 border-t pt-6">
      <div>
        <h2 className="font-display text-foreground text-lg font-semibold">Episódios</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Busque um item na fonte e associe os arquivos aos episódios da temporada. Se
          cada episódio for um item separado, repita o processo — episódios que já têm
          vídeo são mantidos.
        </p>
      </div>

      {seasons.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Esta série ainda não tem temporadas. Importe da TMDB ao criar a série.
        </p>
      ) : (
        seasons.map((season) => (
          <SeasonPanel
            key={season.id}
            seriesId={seriesId}
            seriesTitle={seriesTitle}
            providers={providers}
            season={season}
          />
        ))
      )}
    </section>
  );
}
