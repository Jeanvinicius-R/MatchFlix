"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import {
  approveCandidatesAction,
  type CandidateActionState,
} from "@/app/admin/playback/candidates/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  MATCH_METHOD_LABELS,
  MIN_LICENSE_LENGTH,
  tmdbTitleUrl,
} from "@/features/admin/components/CandidateShared";
import type { CandidateView } from "@/services/playback/candidate.service-core";

interface CandidateRowProps {
  candidate: CandidateView;
  providerLabel: string;
  /** Provider-level licence used only to pre-fill the approval field. */
  suggestedLicenseReference?: string;
  /** True when the candidate can go in a batch (strong id + high score). */
  batchEligible: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  /** A batch operation is running: lock the row. */
  disabled: boolean;
}

const CANDIDATE_TABLE_COLUMNS = 7;

const LINK_CLASSES =
  "text-accent hover:text-accent-strong underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

function scoreTone(candidate: CandidateView): string {
  if (candidate.matchMethod !== "METADATA") return "bg-accent/15 text-accent";
  return candidate.score >= 75
    ? "bg-amber-500/15 text-amber-600"
    : "bg-tint/10 text-muted-foreground";
}

export function CandidateRow({
  candidate,
  providerLabel,
  suggestedLicenseReference,
  batchEligible,
  selected,
  onToggle,
  disabled,
}: CandidateRowProps) {
  const ackId = useId();
  const [isPending, startTransition] = useTransition();
  const [isApproving, setIsApproving] = useState(false);
  const [licenseReference, setLicenseReference] = useState(
    suggestedLicenseReference ?? "",
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [result, setResult] = useState<CandidateActionState | null>(null);

  const isStrongMatch = candidate.matchMethod !== "METADATA";
  const typeLabel =
    candidate.mediaType === "MOVIE"
      ? "Filme"
      : `Série (S${candidate.seasonNumber}E${candidate.episodeNumber})`;
  const licenseError = result?.fieldErrors?.licenseReference?.[0];
  const canSubmit =
    acknowledged && licenseReference.trim().length >= MIN_LICENSE_LENGTH && !isPending;

  function handleApprove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const outcome = await approveCandidatesAction({
        ids: [candidate.id],
        licenseReference: licenseReference.trim(),
        acknowledgeMetadataMatch: acknowledged,
      });
      setResult(outcome);
      if (outcome.ok) {
        setIsApproving(false);
      }
    });
  }

  function handleCancel() {
    setIsApproving(false);
    setAcknowledged(false);
    setLicenseReference(suggestedLicenseReference ?? "");
  }

  return (
    <>
      <tr className="border-border border-t align-top">
        <td className="px-3 py-3">
          <input
            type="checkbox"
            checked={selected}
            disabled={disabled}
            onChange={() => onToggle(candidate.id)}
            aria-label={`Selecionar ${candidate.providerTitle}`}
            className="accent-accent h-4 w-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </td>
        <td className="px-3 py-3">
          <p className="text-foreground font-medium">
            {candidate.providerTitle}
            {candidate.providerYear !== null && (
              <span className="text-muted-foreground font-normal">
                {" "}
                ({candidate.providerYear})
              </span>
            )}
          </p>
          <p className="text-muted-foreground max-w-[16rem] text-xs break-all">
            {providerLabel} · {candidate.providerAssetId}
          </p>
        </td>
        <td className="px-3 py-3 whitespace-nowrap">
          <a
            href={tmdbTitleUrl(candidate)}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK_CLASSES}
          >
            TMDB {candidate.tmdbId}
            <span className="sr-only"> (abre em nova aba)</span>
          </a>
          <p className="text-muted-foreground text-xs">{typeLabel}</p>
        </td>
        <td className="px-3 py-3">
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${
              isStrongMatch ? "bg-accent/15 text-accent" : "bg-amber-500/15 text-amber-600"
            }`}
          >
            {MATCH_METHOD_LABELS[candidate.matchMethod]}
          </span>
        </td>
        <td className="px-3 py-3">
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${scoreTone(candidate)}`}
          >
            {candidate.score}
            <span className="sr-only"> de 100</span>
          </span>
        </td>
        <td className="text-muted-foreground max-w-[18rem] px-3 py-3 text-xs break-words">
          {candidate.reason}
        </td>
        <td className="px-3 py-3">
          {batchEligible ? (
            <p className="text-muted-foreground text-xs">Elegível para aprovação em lote.</p>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="px-3 py-1.5"
              disabled={disabled || isPending}
              aria-expanded={isApproving}
              onClick={() => setIsApproving((current) => !current)}
            >
              Aprovar individualmente
            </Button>
          )}
          <div aria-live="polite" className="mt-2 text-xs">
            {result?.message && (
              <p className={result.ok ? "text-accent" : "text-danger"}>{result.message}</p>
            )}
            {result?.details && (
              <ul className="text-danger list-disc pl-4">
                {result.details.map((detail, index) => (
                  <li key={index} className="break-words">
                    {detail}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </td>
      </tr>
      {isApproving && (
        <tr className="bg-surface/40">
          <td colSpan={CANDIDATE_TABLE_COLUMNS} className="px-3 py-4">
            <form
              onSubmit={handleApprove}
              className="flex max-w-3xl flex-col gap-3"
              noValidate
            >
              <p className="text-muted-foreground text-xs">
                {isStrongMatch
                  ? "Esta correspondência tem nota baixa."
                  : "Esta correspondência foi feita por título/ano, não por identificador."}{" "}
                Compare o título do provedor com o do TMDB antes de aprovar. Aprovar é
                declarar que há autorização para exibir este vídeo; a correspondência
                de título não comprova direitos.
              </p>
              {suggestedLicenseReference && licenseReference === suggestedLicenseReference && (
                <p className="text-xs text-amber-600">
                  Texto pré-preenchido com a licença do acervo deste provedor. Mantenha-o
                  só se ela cobrir este título específico.
                </p>
              )}
              <Input
                label="Licença/contrato que cobre este vídeo"
                value={licenseReference}
                maxLength={500}
                autoComplete="off"
                placeholder="Licença, contrato ou URL oficial que comprova a autorização"
                onChange={(event) => setLicenseReference(event.target.value)}
                error={licenseError}
              />
              <label htmlFor={ackId} className="flex items-start gap-2 text-sm">
                <input
                  id={ackId}
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="accent-accent mt-0.5 h-4 w-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                />
                <span className="text-foreground">
                  Conferi que é o mesmo título e que posso exibi-lo
                </span>
              </label>
              <div className="flex gap-2">
                <Button type="submit" className="px-4 py-1.5" disabled={!canSubmit}>
                  {isPending ? "Aprovando..." : "Aprovar com esta licença"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="px-4 py-1.5"
                  disabled={isPending}
                  onClick={handleCancel}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
