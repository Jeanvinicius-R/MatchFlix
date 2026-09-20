"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { createSeriesAction, updateSeriesAction } from "@/app/admin/series/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { TmdbSearchPicker } from "@/features/admin/components/TmdbSearchPicker";
import { AGE_RATING_LABELS } from "@/repositories/content.mapper";
import type { AdminSeriesDetail } from "@/repositories/series.repository";
import {
  seriesFormSchema,
  updateSeriesFormSchema,
  type SeriesFormInput,
  type UpdateSeriesFormInput,
} from "@/schemas/series.schemas";

type FormValues = Omit<SeriesFormInput, "tmdbId" | "tmdbSeasonNumbers"> & {
  slug?: string;
};

interface SeriesFormProps {
  mode: "create" | "edit";
  series?: AdminSeriesDetail;
  existingGenres: { id: string; name: string }[];
}

const AGE_RATING_OPTIONS = ["L", "10", "12", "14", "16", "18"] as const;

export function SeriesForm({ mode, series, existingGenres }: SeriesFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const [tmdbImport, setTmdbImport] = useState<{
    tmdbId: number;
    seasonNumbers: number[];
    episodeCount: number;
  } | null>(null);

  const defaultValues: FormValues =
    mode === "edit" && series
      ? {
          title: series.title,
          originalTitle: series.originalTitle ?? "",
          synopsis: series.synopsis,
          releaseYear: series.releaseYear,
          ageRating: AGE_RATING_LABELS[series.ageRating],
          genreNames: series.genres.map((genre) => genre.name),
          slug: series.slug,
        }
      : {
          title: "",
          originalTitle: "",
          synopsis: "",
          releaseYear: new Date().getFullYear(),
          ageRating: "L",
          genreNames: [],
        };

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(
      mode === "edit" ? updateSeriesFormSchema : seriesFormSchema,
    ) as never,
    defaultValues,
  });

  const watchedGenreNames = watch("genreNames");
  const genreOptions = useMemo(() => {
    const names = new Set(existingGenres.map((genre) => genre.name));
    for (const name of watchedGenreNames ?? []) {
      names.add(name);
    }
    return Array.from(names);
  }, [existingGenres, watchedGenreNames]);

  async function handleTmdbPick(tmdbId: number) {
    setFormError(null);
    const response = await fetch(`/api/tmdb/series/${tmdbId}`);
    if (!response.ok) {
      setFormError("Não foi possível buscar os detalhes na TMDB.");
      return;
    }
    const { details } = await response.json();

    reset({
      title: details.title,
      originalTitle: details.originalTitle ?? "",
      synopsis: details.synopsis,
      releaseYear: details.releaseYear ?? undefined,
      ageRating: details.ageRating ?? undefined,
      genreNames: details.genreNames ?? [],
    } as FormValues);

    setTmdbImport({
      tmdbId,
      seasonNumbers: details.seasons.map(
        (season: { seasonNumber: number }) => season.seasonNumber,
      ),
      episodeCount: details.seasons.reduce(
        (total: number, season: { episodeCount: number }) => total + season.episodeCount,
        0,
      ),
    });
  }

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    const result =
      mode === "edit" && series
        ? await updateSeriesAction(series.id, data as UpdateSeriesFormInput)
        : await createSeriesAction({
            ...data,
            tmdbId: tmdbImport?.tmdbId,
            tmdbSeasonNumbers: tmdbImport?.seasonNumbers,
          });

    const firstFieldError = result.fieldErrors
      ? Object.values(result.fieldErrors)[0]?.[0]
      : undefined;
    setFormError(result.formError ?? firstFieldError ?? null);
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      {mode === "create" && (
        <>
          <TmdbSearchPicker
            type="series"
            onPick={handleTmdbPick}
            disabled={isSubmitting}
          />
          {tmdbImport && (
            <p className="text-muted-foreground text-sm">
              {tmdbImport.seasonNumbers.length} temporada(s) e {tmdbImport.episodeCount}{" "}
              episódio(s) serão importados da TMDB ao salvar.
            </p>
          )}
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Título" error={errors.title?.message} {...register("title")} />
        <Input
          label="Título original"
          error={errors.originalTitle?.message}
          {...register("originalTitle")}
        />
      </div>

      <Textarea
        label="Sinopse"
        error={errors.synopsis?.message}
        {...register("synopsis")}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Ano de lançamento"
          type="number"
          error={errors.releaseYear?.message}
          {...register("releaseYear")}
        />
        <Select
          label="Classificação"
          error={errors.ageRating?.message}
          {...register("ageRating")}
        >
          {AGE_RATING_OPTIONS.map((rating) => (
            <option key={rating} value={rating}>
              {rating === "L" ? "Livre" : rating}
            </option>
          ))}
        </Select>
      </div>

      {mode === "edit" && (
        <Input label="Slug" error={errors.slug?.message} {...register("slug")} />
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-foreground text-sm font-medium">Gêneros</legend>
        <div className="flex flex-wrap gap-3">
          {genreOptions.map((name) => (
            <label key={name} className="text-foreground flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                value={name}
                className="accent-accent border-border bg-tint/5 h-4 w-4 rounded"
                {...register("genreNames")}
              />
              {name}
            </label>
          ))}
        </div>
        {errors.genreNames?.message && (
          <p className="text-danger text-xs">{errors.genreNames.message}</p>
        )}
      </fieldset>

      {mode === "edit" && series && (
        <div className="border-border rounded-md border p-4">
          <p className="text-foreground text-sm font-medium">
            {series.seasons.length} temporada(s) cadastradas
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Temporadas e episódios só são importados da TMDB na criação da série nesta
            versão do painel — não é possível reimportar por aqui.
          </p>
          {series.seasons.length > 0 && (
            <ul className="text-muted-foreground mt-2 text-xs">
              {series.seasons.map((season) => (
                <li key={season.id}>
                  Temporada {season.seasonNumber}
                  {season.title ? ` — ${season.title}` : ""} ({season._count.episodes}{" "}
                  episódio(s))
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {formError && (
        <p role="alert" className="text-danger text-sm">
          {formError}
        </p>
      )}

      <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
        {isSubmitting
          ? "Salvando..."
          : mode === "edit"
            ? "Salvar alterações"
            : "Criar série"}
      </Button>
    </form>
  );
}
