"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  seedOpenFilmsAction,
  type PlaybackActionState,
} from "@/app/admin/playback/actions";
import { Button } from "@/components/ui/Button";

/** Adds the open-licence (Blender, CC BY) demo films so playback can be tested end to end. */
export function PlaybackSeedButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<PlaybackActionState | null>(null);

  function handleClick() {
    startTransition(async () => {
      setResult(await seedOpenFilmsAction());
    });
  }

  return (
    <div className="border-border flex flex-col gap-3 rounded-md border p-4">
      <div>
        <h2 className="font-display text-foreground text-lg font-semibold">
          Filmes de teste
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Cadastra os filmes abertos da Blender Foundation (licença CC BY), já como
          verificados, para testar a reprodução. Depois, importe cada filme do TMDB em{" "}
          <Link
            href="/admin/movies/new"
            className="text-accent hover:text-accent-strong underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            /admin/movies/new
          </Link>{" "}
          para que ele apareça no catálogo.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={handleClick}
          disabled={isPending}
        >
          {isPending ? "Adicionando..." : "Adicionar filmes de teste (Blender, CC BY)"}
        </Button>
        <div aria-live="polite" className="text-sm">
          {result?.message && (
            <p className={result.ok ? "text-accent" : "text-danger"}>{result.message}</p>
          )}
        </div>
      </div>
    </div>
  );
}
