"use client";

import { useState, useTransition } from "react";
import {
  linkLibraryFilesAction,
  type LibraryLinkActionResult,
} from "@/app/admin/movies/actions";
import { Button } from "@/components/ui/Button";

/** One click: match every video in the library folder to a movie by name and year. */
export function LibraryLinkButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<LibraryLinkActionResult | null>(null);

  function handleClick() {
    startTransition(async () => {
      setResult(await linkLibraryFilesAction());
    });
  }

  const report = result?.report;

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        variant="secondary"
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? "Procurando na pasta..." : "Vincular arquivos da pasta"}
      </Button>

      {result?.formError && (
        <p role="alert" className="text-danger max-w-md text-right text-xs">
          {result.formError}
        </p>
      )}

      {report && (
        <div
          role="status"
          className="border-border bg-surface/60 w-full max-w-md rounded-md border p-3 text-left text-xs"
        >
          <p className="text-foreground font-medium">
            {report.totalFiles} arquivo(s) na pasta · {report.linked.length} vinculado(s)
            agora · {report.stillWithoutVideo} filme(s) ainda sem vídeo
          </p>
          {report.linked.length > 0 && (
            <ul className="text-accent mt-2 list-disc pl-4">
              {report.linked.map((item) => (
                <li key={item.file}>
                  {item.title} ← {item.file}
                </li>
              ))}
            </ul>
          )}
          {report.ambiguous.length > 0 && (
            <p className="text-muted-foreground mt-2">
              Ambíguos (ignorados): {report.ambiguous.map((a) => a.file).join(", ")}
            </p>
          )}
          {report.unmatchedFiles.length > 0 && (
            <p className="text-muted-foreground mt-2">
              Sem filme correspondente: {report.unmatchedFiles.join(", ")}. Confira se o
              nome segue o formato “Título (Ano).mp4”.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
