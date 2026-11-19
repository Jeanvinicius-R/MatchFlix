"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import {
  syncProviderAction,
  type CandidateActionState,
} from "@/app/admin/playback/candidates/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { CandidateAdapterOption } from "@/features/admin/components/CandidateShared";

interface CandidateSyncPanelProps {
  adapters: CandidateAdapterOption[];
}

const MAX_FAILURES_SHOWN = 10;

function describeCapabilities(adapter: CandidateAdapterOption | undefined): string {
  if (!adapter) return "";
  if (adapter.canListCatalog) {
    return "Percorre o catálogo do provedor e sugere correspondências com os títulos do TMDB.";
  }
  if (adapter.canDiscover) {
    return "Pesquisa no provedor cada título do catálogo local e sugere correspondências.";
  }
  return "Este provedor não oferece sincronização.";
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000
    ? `${durationMs} ms`
    : `${(durationMs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`;
}

export function CandidateSyncPanel({ adapters }: CandidateSyncPanelProps) {
  const helpId = useId();
  const [isPending, startTransition] = useTransition();
  const syncable = adapters.filter(
    (adapter) => adapter.canDiscover || adapter.canListCatalog,
  );
  const [providerId, setProviderId] = useState(syncable[0]?.id ?? "");
  const [limit, setLimit] = useState("");
  const [result, setResult] = useState<CandidateActionState | null>(null);

  const selected = syncable.find((adapter) => adapter.id === providerId);
  const limitError = result?.fieldErrors?.limit?.[0];
  const providerError = result?.fieldErrors?.providerId?.[0];
  const report = result?.report;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedLimit = limit.trim();
    // Client input is only a convenience; the action re-validates everything.
    const input = {
      providerId,
      limit: trimmedLimit === "" ? undefined : Number(trimmedLimit),
    };
    startTransition(async () => {
      setResult(await syncProviderAction(input));
    });
  }

  return (
    <section
      aria-labelledby="sync-heading"
      className="border-border flex flex-col gap-4 rounded-md border p-4"
    >
      <div>
        <h2 id="sync-heading" className="font-display text-foreground text-lg font-semibold">
          Sincronizar com um provedor
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          A sincronização apenas <strong>sugere</strong> correspondências entre o
          provedor e o TMDB. Nada fica disponível para os espectadores até você revisar
          e aprovar cada sugestão, declarando a licença que cobre o vídeo.
        </p>
      </div>

      {syncable.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nenhum provedor registrado oferece sincronização. Configure servidores em{" "}
          <code>PLAYBACK_SERVERS</code>.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Select
              label="Provedor"
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
              aria-describedby={helpId}
              error={providerError}
            >
              {syncable.map((adapter) => (
                <option key={adapter.id} value={adapter.id}>
                  {adapter.label}
                </option>
              ))}
            </Select>
            <Input
              label="Limite de itens (opcional)"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              error={limitError}
            />
          </div>
          <p id={helpId} className="text-muted-foreground text-xs">
            {describeCapabilities(selected)}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={isPending || !providerId}>
              {isPending ? "Sincronizando..." : "Sincronizar agora"}
            </Button>
            {isPending && (
              <span className="text-muted-foreground text-sm">
                Isso pode levar alguns minutos. Não feche a página.
              </span>
            )}
          </div>
        </form>
      )}

      <div aria-live="polite" className="text-sm">
        {result?.message && (
          <p className={result.ok ? "text-accent" : "text-danger"}>{result.message}</p>
        )}
        {report && (
          <div className="mt-3 flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <ReportStat label="Examinados" value={report.scanned.toLocaleString("pt-BR")} />
              <ReportStat
                label="Sugestões novas"
                value={report.created.toLocaleString("pt-BR")}
              />
              <ReportStat
                label="Já existentes"
                value={report.skippedExisting.toLocaleString("pt-BR")}
              />
              <ReportStat label="Falhas" value={report.failures.length.toLocaleString("pt-BR")} />
              <ReportStat label="Duração" value={formatDuration(report.durationMs)} />
            </dl>
            {report.failures.length > 0 && (
              <div>
                <p className="text-foreground text-xs font-medium">Falhas encontradas</p>
                <ul className="text-danger mt-1 list-disc pl-5 text-xs">
                  {report.failures.slice(0, MAX_FAILURES_SHOWN).map((failure, index) => (
                    <li key={index} className="break-words">
                      {failure}
                    </li>
                  ))}
                </ul>
                {report.failures.length > MAX_FAILURES_SHOWN && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    ... e mais {report.failures.length - MAX_FAILURES_SHOWN} falha(s).
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ReportStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border bg-surface/60 rounded-md border px-3 py-2">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground text-base font-semibold">{value}</dd>
    </div>
  );
}
