"use client";

import { useState, useTransition } from "react";
import {
  reverifyAssociationsAction,
  type CandidateActionState,
} from "@/app/admin/playback/candidates/actions";
import { Button } from "@/components/ui/Button";

/** Re-checks the oldest verified associations against their providers, in one go. */
export function SyncReverifyButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<CandidateActionState | null>(null);

  function handleClick() {
    startTransition(async () => {
      setResult(await reverifyAssociationsAction());
    });
  }

  return (
    <div className="border-border flex flex-col gap-3 rounded-md border p-4">
      <div>
        <h2 className="font-display text-foreground text-lg font-semibold">
          Reverificar disponibilidade
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Confere de novo, nos provedores, as associações verificadas com a checagem mais
          antiga (até 25 por vez). As que sumirem do provedor passam a indisponíveis e
          deixam de ser exibidas. Isso não altera os direitos.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={handleClick}
          disabled={isPending}
        >
          {isPending ? "Reverificando..." : "Reverificar as 25 mais antigas"}
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
