"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { createMovieAction, updateMovieAction } from "@/app/admin/movies/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { TmdbSearchPicker } from "@/features/admin/components/TmdbSearchPicker";
import { AGE_RATING_LABELS } from "@/repositories/content.mapper";
import {
  movieFormSchema,
  updateMovieFormSchema,
  type MovieFormInput,
  type UpdateMovieFormInput,
} from "@/schemas/movie.schemas";
import type { AdminMovieRecord } from "@/repositories/movie.repository";

type FormValues = MovieFormInput & { slug?: string };

interface MovieFormProps {
  mode: "create" | "edit";
  movie?: AdminMovieRecord;
  existingGenres: { id: string; name: string }[];
}

const AGE_RATING_OPTIONS = ["L", "10", "12", "14", "16", "18"] as const;

export function MovieForm({ mode, movie, existingGenres }: MovieFormProps) {
  const [formError, setFormError] = useState<string | null>(null);

  const defaultValues: FormValues =
    mode === "edit" && movie
      ? {
          title: movie.title,
          originalTitle: movie.originalTitle ?? "",
          synopsis: movie.synopsis,
          releaseYear: movie.releaseYear,
          ageRating: AGE_RATING_LABELS[movie.ageRating],
          durationInMinutes: movie.durationInMinutes,
          genreNames: movie.genres.map((genre) => genre.name),
          slug: movie.slug,
        }
      : {
          title: "",
          originalTitle: "",
          synopsis: "",
          releaseYear: new Date().getFullYear(),
          ageRating: "L",
          durationInMinutes: 0,
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
      mode === "edit" ? updateMovieFormSchema : movieFormSchema,
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
    const response = await fetch(`/api/tmdb/movie/${tmdbId}`);
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
      durationInMinutes: details.durationInMinutes ?? undefined,
      genreNames: details.genreNames ?? [],
    } as FormValues);
  }

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    const result =
      mode === "edit" && movie
        ? await updateMovieAction(movie.id, data as UpdateMovieFormInput)
        : await createMovieAction(data);

    const firstFieldError = result.fieldErrors
      ? Object.values(result.fieldErrors)[0]?.[0]
      : undefined;
    setFormError(result.formError ?? firstFieldError ?? null);
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      {mode === "create" && (
        <TmdbSearchPicker type="movie" onPick={handleTmdbPick} disabled={isSubmitting} />
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

      <div className="grid gap-4 sm:grid-cols-3">
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
        <Input
          label="Duração (minutos)"
          type="number"
          error={errors.durationInMinutes?.message}
          {...register("durationInMinutes")}
        />
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
                className="accent-accent border-border h-4 w-4 rounded bg-white/5"
                {...register("genreNames")}
              />
              {name}
            </label>
          ))}
        </div>
        {errors.genreNames?.message && (
          <p className="text-xs text-red-400">{errors.genreNames.message}</p>
        )}
      </fieldset>

      {formError && (
        <p role="alert" className="text-sm text-red-400">
          {formError}
        </p>
      )}

      <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
        {isSubmitting
          ? "Salvando..."
          : mode === "edit"
            ? "Salvar alterações"
            : "Criar filme"}
      </Button>
    </form>
  );
}
