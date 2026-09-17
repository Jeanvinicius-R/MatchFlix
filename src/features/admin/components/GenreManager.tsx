"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import {
  createGenreAction,
  deleteGenreAction,
  updateGenreAction,
} from "@/app/admin/genres/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { genreFormSchema, type GenreFormInput } from "@/schemas/genre.schemas";

interface GenreListItem {
  id: string;
  name: string;
  slug: string;
  _count: { movies: number; series: number };
}

interface GenreManagerProps {
  genres: GenreListItem[];
}

export function GenreManager({ genres }: GenreManagerProps) {
  return (
    <div className="flex flex-col gap-6">
      <CreateGenreForm />
      <ul className="flex flex-col gap-2">
        {genres.map((genre) => (
          <GenreRow key={genre.id} genre={genre} />
        ))}
        {genres.length === 0 && (
          <p className="text-muted-foreground text-sm">Nenhum gênero cadastrado ainda.</p>
        )}
      </ul>
    </div>
  );
}

function CreateGenreForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<GenreFormInput>({
    resolver: zodResolver(genreFormSchema),
    defaultValues: { name: "" },
  });

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    const result = await createGenreAction(data);
    const firstFieldError = result.fieldErrors
      ? Object.values(result.fieldErrors)[0]?.[0]
      : undefined;
    const error = result.formError ?? firstFieldError ?? null;
    setFormError(error);
    if (!error) {
      reset({ name: "" });
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex items-start gap-3" noValidate>
      <div className="flex-1">
        <Input
          label="Novo gênero"
          error={errors.name?.message ?? formError ?? undefined}
          {...register("name")}
        />
      </div>
      <Button type="submit" disabled={isSubmitting} className="mt-7">
        {isSubmitting ? "Adicionando..." : "Adicionar"}
      </Button>
    </form>
  );
}

function GenreRow({ genre }: { genre: GenreListItem }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<GenreFormInput>({
    resolver: zodResolver(genreFormSchema),
    defaultValues: { name: genre.name },
  });

  const usageCount = genre._count.movies + genre._count.series;

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    const result = await updateGenreAction(genre.id, data);
    const firstFieldError = result.fieldErrors
      ? Object.values(result.fieldErrors)[0]?.[0]
      : undefined;
    const error = result.formError ?? firstFieldError ?? null;
    setFormError(error);
    if (!error) {
      setIsEditing(false);
    }
  });

  function handleDelete() {
    if (!confirm(`Excluir o gênero "${genre.name}"? Essa ação não pode ser desfeita.`)) {
      return;
    }
    startTransition(() => deleteGenreAction(genre.id));
  }

  if (isEditing) {
    return (
      <li className="border-border flex items-start gap-3 rounded-md border p-3">
        <form onSubmit={onSubmit} className="flex flex-1 items-start gap-3" noValidate>
          <div className="flex-1">
            <Input
              label="Nome"
              error={errors.name?.message ?? formError ?? undefined}
              {...register("name")}
            />
          </div>
          <Button type="submit" className="mt-7">
            Salvar
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="mt-7"
            onClick={() => setIsEditing(false)}
          >
            Cancelar
          </Button>
        </form>
      </li>
    );
  }

  return (
    <li className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
      <div>
        <p className="text-foreground text-sm font-medium">{genre.name}</p>
        <p className="text-muted-foreground text-xs">
          {usageCount === 0 ? "Não usado" : `Usado em ${usageCount} título(s)`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" onClick={() => setIsEditing(true)}>
          Editar
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={handleDelete}
        >
          {isPending ? "Excluindo..." : "Excluir"}
        </Button>
      </div>
    </li>
  );
}
