"use client";

import { useState } from "react";
import {
  addEpisodeAction,
  addSeasonAction,
  syncSeasonsAction,
  updateEpisodeAction,
  type SeasonActionState,
} from "@/app/admin/series/actions";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface EpisodeRow {
  id: string;
  episodeNumber: number;
  title: string;
  synopsis: string | null;
  durationInMinutes: number | null;
}

interface SeasonRow {
  id: string;
  seasonNumber: number;
  title: string | null;
  episodes: EpisodeRow[];
}

interface TmdbSeasonOption {
  seasonNumber: number;
  title: string;
  episodeCount: number;
}

interface SeriesSeasonsManagerProps {
  seriesId: string;
  hasTmdbId: boolean;
  /** null when the series has a TMDB id but TMDB could not be reached. */
  tmdbSeasons: TmdbSeasonOption[] | null;
  seasons: SeasonRow[];
}

type Feedback = { text: string; isError: boolean } | null;

function toFeedback(result: SeasonActionState): Feedback {
  const fieldError = result.fieldErrors ? Object.values(result.fieldErrors)[0]?.[0] : undefined;
  const error = result.formError ?? fieldError;
  if (error) {
    return { text: error, isError: true };
  }
  return result.message ? { text: result.message, isError: false } : null;
}

function FeedbackText({ feedback }: { feedback: Feedback }) {
  if (!feedback) {
    return null;
  }
  return (
    <p
      role={feedback.isError ? "alert" : "status"}
      className={cn("text-sm", feedback.isError ? "text-danger" : "text-accent")}
    >
      {feedback.text}
    </p>
  );
}

const FIELD = "border-border bg-background text-foreground rounded-md border px-2 py-1.5 text-sm";

function TmdbSyncPanel({
  seriesId,
  tmdbSeasons,
  existingNumbers,
}: {
  seriesId: string;
  tmdbSeasons: TmdbSeasonOption[];
  existingNumbers: Set<number>;
}) {
  // Specials (season 0) start unchecked; everything else is preselected.
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(tmdbSeasons.filter((s) => s.seasonNumber > 0).map((s) => s.seasonNumber)),
  );
  const [updateExisting, setUpdateExisting] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function handleSync() {
    setIsBusy(true);
    setFeedback(null);
    const result = await syncSeasonsAction(seriesId, {
      seasonNumbers: [...selected].sort((a, b) => a - b),
      updateExisting,
    });
    setIsBusy(false);
    setFeedback(toFeedback(result));
  }

  return (
    <div className="border-border flex flex-col gap-3 rounded-md border p-4">
      <h3 className="text-foreground text-sm font-semibold">Importar/atualizar da TMDB</h3>
      <p className="text-muted-foreground text-xs">
        Cria temporadas e episódios que faltam. Nada é apagado e vídeos vinculados são
        mantidos.
      </p>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="sr-only">Temporadas da TMDB</legend>
        {tmdbSeasons.map((season) => (
          <label key={season.seasonNumber} className="text-foreground flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-accent"
              checked={selected.has(season.seasonNumber)}
              onChange={(event) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (event.target.checked) {
                    next.add(season.seasonNumber);
                  } else {
                    next.delete(season.seasonNumber);
                  }
                  return next;
                })
              }
            />
            {season.title} · {season.episodeCount} ep.
            {existingNumbers.has(season.seasonNumber) && (
              <span className="text-muted-foreground text-xs">(já existe)</span>
            )}
          </label>
        ))}
      </fieldset>
      <label className="text-foreground flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-accent"
          checked={updateExisting}
          onChange={(event) => setUpdateExisting(event.target.checked)}
        />
        Também atualizar título, sinopse e duração do que já existe
      </label>
      <FeedbackText feedback={feedback} />
      <Button
        type="button"
        onClick={handleSync}
        disabled={isBusy || selected.size === 0}
        className="w-full sm:w-auto sm:self-start"
      >
        {isBusy ? "Importando..." : `Importar ${selected.size} temporada(s)`}
      </Button>
    </div>
  );
}

function AddSeasonForm({ seriesId }: { seriesId: string }) {
  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function handleSubmit(formData: FormData) {
    setIsBusy(true);
    setFeedback(null);
    const result = await addSeasonAction(seriesId, {
      seasonNumber: formData.get("seasonNumber"),
      title: formData.get("title"),
    });
    setIsBusy(false);
    setFeedback(toFeedback(result));
  }

  return (
    <form action={handleSubmit} className="flex flex-wrap items-end gap-2">
      <label className="text-muted-foreground flex flex-col gap-1 text-xs">
        Nº da temporada
        <input name="seasonNumber" type="number" min={0} required className={cn(FIELD, "w-24")} />
      </label>
      <label className="text-muted-foreground flex flex-1 flex-col gap-1 text-xs">
        Título (opcional)
        <input name="title" type="text" maxLength={200} className={FIELD} />
      </label>
      <Button type="submit" variant="secondary" disabled={isBusy}>
        Adicionar temporada
      </Button>
      <div className="basis-full">
        <FeedbackText feedback={feedback} />
      </div>
    </form>
  );
}

function EpisodeFields({ episode }: { episode?: EpisodeRow }) {
  return (
    <>
      <label className="text-muted-foreground flex flex-1 flex-col gap-1 text-xs">
        Título
        <input
          name="title"
          type="text"
          required
          maxLength={200}
          defaultValue={episode?.title}
          className={FIELD}
        />
      </label>
      <label className="text-muted-foreground flex flex-col gap-1 text-xs">
        Duração (min)
        <input
          name="durationInMinutes"
          type="number"
          min={1}
          defaultValue={episode?.durationInMinutes ?? ""}
          className={cn(FIELD, "w-24")}
        />
      </label>
      <label className="text-muted-foreground flex basis-full flex-col gap-1 text-xs">
        Sinopse
        <textarea
          name="synopsis"
          rows={2}
          maxLength={2000}
          defaultValue={episode?.synopsis ?? ""}
          className={FIELD}
        />
      </label>
    </>
  );
}

function EpisodeEditor({ seriesId, episode }: { seriesId: string; episode: EpisodeRow }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function handleSubmit(formData: FormData) {
    setIsBusy(true);
    setFeedback(null);
    const result = await updateEpisodeAction(seriesId, {
      episodeId: episode.id,
      title: formData.get("title"),
      synopsis: formData.get("synopsis"),
      durationInMinutes: formData.get("durationInMinutes"),
    });
    setIsBusy(false);
    const next = toFeedback(result);
    setFeedback(next);
    if (next && !next.isError) {
      setIsOpen(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 py-2 text-sm">
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground w-10 shrink-0">
          E{String(episode.episodeNumber).padStart(2, "0")}
        </span>
        <span className="text-foreground min-w-0 flex-1 truncate">{episode.title}</span>
        <button
          type="button"
          onClick={() => setIsOpen((value) => !value)}
          aria-expanded={isOpen}
          className="text-muted-foreground hover:text-foreground text-xs underline"
        >
          {isOpen ? "Fechar" : "Editar"}
        </button>
      </div>
      {isOpen && (
        <form action={handleSubmit} className="flex flex-wrap items-end gap-2 pl-13">
          <EpisodeFields episode={episode} />
          <Button type="submit" variant="secondary" disabled={isBusy}>
            Salvar episódio
          </Button>
        </form>
      )}
      <FeedbackText feedback={feedback} />
    </li>
  );
}

function SeasonEditor({ seriesId, season }: { seriesId: string; season: SeasonRow }) {
  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const nextNumber = (season.episodes.at(-1)?.episodeNumber ?? 0) + 1;

  async function handleAdd(formData: FormData) {
    setIsBusy(true);
    setFeedback(null);
    const result = await addEpisodeAction(seriesId, {
      seasonId: season.id,
      episodeNumber: formData.get("episodeNumber"),
      title: formData.get("title"),
      synopsis: formData.get("synopsis"),
      durationInMinutes: formData.get("durationInMinutes"),
    });
    setIsBusy(false);
    setFeedback(toFeedback(result));
  }

  return (
    <details className="border-border rounded-md border">
      <summary className="text-foreground cursor-pointer px-4 py-3 text-sm font-medium">
        Temporada {season.seasonNumber}
        {season.title ? ` — ${season.title}` : ""}
        <span className="text-muted-foreground font-normal"> · {season.episodes.length} ep.</span>
      </summary>
      <div className="border-border flex flex-col gap-4 border-t p-4">
        <ul className="divide-tint/5 flex flex-col divide-y">
          {season.episodes.map((episode) => (
            <EpisodeEditor key={episode.id} seriesId={seriesId} episode={episode} />
          ))}
        </ul>
        <form action={handleAdd} className="flex flex-wrap items-end gap-2">
          <label className="text-muted-foreground flex flex-col gap-1 text-xs">
            Nº do episódio
            <input
              name="episodeNumber"
              type="number"
              min={1}
              required
              defaultValue={nextNumber}
              key={nextNumber}
              className={cn(FIELD, "w-24")}
            />
          </label>
          <EpisodeFields />
          <Button type="submit" variant="secondary" disabled={isBusy}>
            Adicionar episódio
          </Button>
        </form>
        <FeedbackText feedback={feedback} />
      </div>
    </details>
  );
}

/** Seasons and episodes of an existing series: TMDB re-import, manual additions and edits. */
export function SeriesSeasonsManager({
  seriesId,
  hasTmdbId,
  tmdbSeasons,
  seasons,
}: SeriesSeasonsManagerProps) {
  return (
    <section className="border-border flex flex-col gap-4 border-t pt-6">
      <div>
        <h2 className="font-display text-foreground text-lg font-semibold">
          Temporadas e episódios
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Importe da TMDB, adicione manualmente ou edite os dados de cada episódio.
        </p>
      </div>

      {!hasTmdbId ? (
        <p className="text-muted-foreground text-xs">
          Para importar da TMDB, preencha o TMDB ID da série no formulário acima.
        </p>
      ) : tmdbSeasons ? (
        <TmdbSyncPanel
          seriesId={seriesId}
          tmdbSeasons={tmdbSeasons}
          existingNumbers={new Set(seasons.map((season) => season.seasonNumber))}
        />
      ) : (
        <p role="alert" className="text-danger text-xs">
          Não foi possível consultar as temporadas na TMDB agora. Recarregue a página para
          tentar de novo.
        </p>
      )}

      <AddSeasonForm seriesId={seriesId} />

      {seasons.map((season) => (
        <SeasonEditor key={season.id} seriesId={seriesId} season={season} />
      ))}
    </section>
  );
}
