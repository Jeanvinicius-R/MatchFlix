"use client";

import { useId, useState, useTransition } from "react";
import {
  approveCandidatesAction,
  rejectCandidatesAction,
  type CandidateActionState,
} from "@/app/admin/playback/candidates/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { CandidateRow } from "@/features/admin/components/CandidateRow";
import {
  isBatchEligible,
  MIN_LICENSE_LENGTH,
  type CandidateAdapterOption,
} from "@/features/admin/components/CandidateShared";
import type { CandidateView } from "@/services/playback/candidate.service-core";

interface CandidateReviewTableProps {
  candidates: CandidateView[];
  adapters: CandidateAdapterOption[];
  /** BATCH_APPROVAL_MIN_SCORE, read on the server. */
  batchMinScore: number;
}

const TABLE_HEADERS = [
  "Título no provedor",
  "Título no TMDB",
  "Método",
  "Nota",
  "Motivo",
  "Ações",
];

export function CandidateReviewTable({
  candidates,
  adapters,
  batchMinScore,
}: CandidateReviewTableProps) {
  const licenseHelpId = useId();
  const coverageId = useId();
  const [isApproving, startApprove] = useTransition();
  const [isRejecting, startReject] = useTransition();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set<string>());
  // null = the admin has not typed yet, so the provider's suggestion applies.
  const [licenseDraft, setLicenseDraft] = useState<string | null>(null);
  // The selection the admin confirmed the licence for. Any change to the selection
  // invalidates it, so the box is never silently carried over to other titles.
  const [coverageKey, setCoverageKey] = useState<string | null>(null);
  const [result, setResult] = useState<CandidateActionState | null>(null);

  const isBusy = isApproving || isRejecting;
  const adapterById = new Map(adapters.map((adapter) => [adapter.id, adapter]));

  // Ids that vanished after a refresh must not linger in the selection.
  const selectedCandidates = candidates.filter((candidate) => selected.has(candidate.id));
  const ineligibleCount = selectedCandidates.filter(
    (candidate) => !isBatchEligible(candidate, batchMinScore),
  ).length;
  const providerIds = new Set(selectedCandidates.map((candidate) => candidate.provider));
  const suggestedLicense =
    providerIds.size === 1
      ? adapterById.get([...providerIds][0])?.suggestedLicenseReference
      : undefined;
  const licenseReference = licenseDraft ?? suggestedLicense ?? "";
  const isPrefilled = licenseDraft === null && suggestedLicense !== undefined;
  const licenseError = result?.fieldErrors?.licenseReference?.[0];

  const allSelected = candidates.length > 0 && selectedCandidates.length === candidates.length;
  const someSelected = selectedCandidates.length > 0 && !allSelected;

  const selectedCount = selectedCandidates.length;
  const isMultiple = selectedCount > 1;
  const selectionKey = selectedCandidates
    .map((candidate) => candidate.id)
    .sort()
    .join(",");
  // Never pre-checked: only an explicit click, for exactly this selection, counts.
  const coverageConfirmed = coverageKey !== null && coverageKey === selectionKey;
  const mixedProviders = providerIds.size > 1;

  const canApprove =
    !isBusy &&
    selectedCount > 0 &&
    ineligibleCount === 0 &&
    !mixedProviders &&
    (!isMultiple || coverageConfirmed) &&
    licenseReference.trim().length >= MIN_LICENSE_LENGTH;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelected(
      allSelected ? new Set<string>() : new Set(candidates.map((c) => c.id)),
    );
  }

  function selectBatchEligible() {
    setSelected(
      new Set(
        candidates
          .filter((candidate) => isBatchEligible(candidate, batchMinScore))
          .map((candidate) => candidate.id),
      ),
    );
  }

  function clearSelection() {
    setSelected(new Set<string>());
    setLicenseDraft(null);
    setCoverageKey(null);
  }

  function handleApprove() {
    const ids = selectedCandidates.map((candidate) => candidate.id);
    const confirmed = confirm(
      `Você declara que há autorização para exibir TODOS os ${ids.length} vídeo(s) selecionado(s), conforme a licença informada?\n\n"${licenseReference.trim()}"\n\nA licença ficará registrada em cada um. Eles só aparecem para os espectadores depois que o provedor confirmar a disponibilidade.`,
    );
    if (!confirmed) return;
    startApprove(async () => {
      const outcome = await approveCandidatesAction({
        ids,
        licenseReference: licenseReference.trim(),
        // Sent only when the box was checked for this exact selection.
        ...(isMultiple ? { licenseCoversAllSelected: coverageConfirmed } : {}),
      });
      setResult(outcome);
      // Approved rows leave the list on refresh; on failure keep the selection.
      if (outcome.ok) {
        clearSelection();
      }
    });
  }

  function handleReject() {
    const ids = selectedCandidates.map((candidate) => candidate.id);
    const confirmed = confirm(
      `Rejeitar ${ids.length} candidato(s)? Eles não serão sugeridos de novo.`,
    );
    if (!confirmed) return;
    startReject(async () => {
      const outcome = await rejectCandidatesAction(ids);
      setResult(outcome);
      if (outcome.ok) {
        clearSelection();
      }
    });
  }

  if (candidates.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nenhuma sugestão pendente com estes filtros. Use &quot;Sincronizar agora&quot;
        para buscar novas sugestões.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="border-border flex flex-col gap-3 rounded-md border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-foreground text-sm font-medium" aria-live="polite">
            {selectedCandidates.length} selecionado(s)
          </p>
          <Button
            type="button"
            variant="ghost"
            className="px-3 py-1.5"
            disabled={isBusy}
            onClick={selectBatchEligible}
          >
            Selecionar elegíveis ao lote
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="px-3 py-1.5"
            disabled={isBusy || selected.size === 0}
            onClick={clearSelection}
          >
            Limpar seleção
          </Button>
        </div>

        <Input
          label="Licença/contrato que cobre estes vídeos"
          value={licenseReference}
          maxLength={500}
          autoComplete="off"
          placeholder="Licença, contrato ou URL oficial que comprova a autorização"
          onChange={(event) => setLicenseDraft(event.target.value)}
          error={licenseError}
          {...(licenseError ? {} : { "aria-describedby": licenseHelpId })}
        />
        <p id={licenseHelpId} className="text-muted-foreground text-xs">
          Aprovar é <strong>declarar que há autorização</strong> para exibir TODOS os
          vídeos selecionados, e essa referência fica registrada em cada um. Uma nota
          alta do TMDB/IMDb só prova que é o mesmo título, <strong>não</strong> que há
          licença. Só entram no lote candidatos achados por identificador com nota de{" "}
          {batchMinScore} ou mais, de um único provedor; os demais exigem aprovação
          individual. Rejeitar funciona para qualquer seleção.
        </p>
        {isPrefilled && (
          <p role="status" className="text-xs text-amber-600">
            Texto pré-preenchido com a licença do acervo configurada para este provedor.
            Ele só vale se cobrir de fato cada título selecionado: edite-o ou desmarque o
            que ficar de fora.
          </p>
        )}
        {mixedProviders && (
          <p role="status" className="text-xs text-danger">
            A seleção mistura {providerIds.size} provedores. Uma licença não pode ser
            usada em lote para provedores diferentes: selecione um provedor por vez.
          </p>
        )}
        {isMultiple && !mixedProviders && (
          <label
            htmlFor={coverageId}
            className="flex items-start gap-2 text-sm"
          >
            <input
              id={coverageId}
              type="checkbox"
              checked={coverageConfirmed}
              disabled={isBusy}
              onChange={(event) =>
                setCoverageKey(event.target.checked ? selectionKey : null)
              }
              aria-invalid={Boolean(result?.fieldErrors?.licenseCoversAllSelected)}
              className="accent-accent mt-0.5 h-4 w-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            />
            <span className="text-foreground">
              Confirmo que esta licença/contrato abrange TODOS os {selectedCount} títulos
              selecionados
            </span>
          </label>
        )}
        {ineligibleCount > 0 && (
          <p role="status" className="text-xs text-amber-600">
            {ineligibleCount} selecionado(s) não podem ser aprovados em lote. Desmarque-os
            ou use &quot;Aprovar individualmente&quot;.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={!canApprove} onClick={handleApprove}>
            {isApproving ? "Aprovando..." : "Aprovar selecionados"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={isBusy || selectedCandidates.length === 0}
            onClick={handleReject}
          >
            {isRejecting ? "Rejeitando..." : "Rejeitar selecionados"}
          </Button>
        </div>

        <div aria-live="polite" className="text-sm">
          {result?.message && (
            <p className={result.ok ? "text-accent" : "text-danger"}>{result.message}</p>
          )}
          {result?.details && (
            <ul className="text-danger mt-1 list-disc pl-5 text-xs">
              {result.details.map((detail, index) => (
                <li key={index} className="break-words">
                  {detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="border-border overflow-x-auto rounded-md border">
        <table className="text-foreground w-full text-left text-sm">
          <caption className="sr-only">
            Sugestões pendentes de vídeos de provedores para títulos do TMDB, ordenadas
            pela nota
          </caption>
          <thead className="bg-surface/60 text-muted-foreground text-xs">
            <tr>
              <th scope="col" className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={isBusy}
                  onChange={toggleAll}
                  aria-label="Selecionar todos os candidatos listados"
                  ref={(element) => {
                    if (element) element.indeterminate = someSelected;
                  }}
                  className="accent-accent h-4 w-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                />
              </th>
              {TABLE_HEADERS.map((header) => (
                <th key={header} scope="col" className="px-3 py-2 font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => {
              const adapter = adapterById.get(candidate.provider);
              return (
                <CandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  providerLabel={adapter?.label ?? candidate.provider}
                  suggestedLicenseReference={adapter?.suggestedLicenseReference}
                  batchEligible={isBatchEligible(candidate, batchMinScore)}
                  selected={selected.has(candidate.id)}
                  onToggle={toggle}
                  disabled={isBusy}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
