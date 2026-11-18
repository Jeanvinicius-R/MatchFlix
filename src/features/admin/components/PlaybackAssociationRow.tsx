"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import {
  removeAssociationAction,
  setAssociationRightsAction,
  verifyAssociationAction,
  type PlaybackActionState,
} from "@/app/admin/playback/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { RIGHTS_STATUSES } from "@/schemas/playback-association.schemas";
import type { AssociationView } from "@/services/playback-association.service";

interface PlaybackAssociationRowProps {
  association: AssociationView;
  /** Display name of the provider adapter (falls back to its id). */
  providerLabel: string;
}

type BadgeTone = "success" | "warning" | "danger" | "neutral";

const BADGE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-accent/15 text-accent",
  warning: "bg-amber-500/15 text-amber-600",
  danger: "bg-danger/15 text-danger",
  neutral: "bg-tint/10 text-muted-foreground",
};

const RIGHTS_LABELS: Record<AssociationView["rightsStatus"], string> = {
  UNVERIFIED: "Não verificado",
  VERIFIED: "Verificado",
  EXPIRED: "Expirado",
  REVOKED: "Revogado",
};

const RIGHTS_TONES: Record<AssociationView["rightsStatus"], BadgeTone> = {
  UNVERIFIED: "neutral",
  VERIFIED: "success",
  EXPIRED: "warning",
  REVOKED: "danger",
};

const AVAILABILITY_LABELS: Record<AssociationView["availabilityStatus"], string> = {
  UNKNOWN: "Não checada",
  AVAILABLE: "Disponível",
  UNAVAILABLE: "Indisponível",
};

const AVAILABILITY_TONES: Record<AssociationView["availabilityStatus"], BadgeTone> = {
  UNKNOWN: "neutral",
  AVAILABLE: "success",
  UNAVAILABLE: "danger",
};

// Fixed time zone keeps server and client renders identical (no hydration drift).
const DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

function formatDate(date: Date | null): string {
  return date ? DATE_FORMATTER.format(date) : "Nunca";
}

function Badge({ tone, children }: { tone: BadgeTone; children: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${BADGE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

export function PlaybackAssociationRow({
  association,
  providerLabel,
}: PlaybackAssociationRowProps) {
  const rightsHelpId = useId();
  const [isVerifying, startVerify] = useTransition();
  const [isSaving, startSave] = useTransition();
  const [isRemoving, startRemove] = useTransition();
  const [isEditingRights, setIsEditingRights] = useState(false);
  const [rightsStatus, setRightsStatus] = useState(association.rightsStatus);
  const [licenseReference, setLicenseReference] = useState(
    association.licenseReference ?? "",
  );
  const [result, setResult] = useState<PlaybackActionState | null>(null);

  const isBusy = isVerifying || isSaving || isRemoving;
  const typeLabel =
    association.mediaType === "MOVIE"
      ? "Filme"
      : `Episódio S${association.seasonNumber}E${association.episodeNumber}`;
  const licenseError = result?.fieldErrors?.licenseReference?.[0];

  function handleVerify() {
    startVerify(async () => {
      setResult(await verifyAssociationAction(association.id));
    });
  }

  function handleRemove() {
    const confirmed = confirm(
      `Remover a associação do TMDB ${association.tmdbId} (${providerLabel})? Essa ação não pode ser desfeita.`,
    );
    if (!confirmed) return;
    startRemove(async () => {
      setResult(await removeAssociationAction(association.id));
    });
  }

  function handleSaveRights(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedLicense = licenseReference.trim();
    startSave(async () => {
      const outcome = await setAssociationRightsAction({
        id: association.id,
        rightsStatus,
        // An empty string clears the stored reference (undefined would keep it).
        licenseReference: trimmedLicense,
      });
      setResult(outcome);
      if (outcome.ok) {
        setIsEditingRights(false);
      }
    });
  }

  function handleCancelRights() {
    setRightsStatus(association.rightsStatus);
    setLicenseReference(association.licenseReference ?? "");
    setIsEditingRights(false);
  }

  return (
    <>
      <tr className="border-border border-t align-top">
        <td className="px-3 py-3 whitespace-nowrap">{association.tmdbId}</td>
        <td className="px-3 py-3 whitespace-nowrap">{typeLabel}</td>
        <td className="px-3 py-3">
          <p className="text-foreground font-medium">{providerLabel}</p>
          <p className="text-muted-foreground max-w-[14rem] text-xs break-all">
            {association.providerAssetId}
          </p>
        </td>
        <td className="px-3 py-3 whitespace-nowrap">
          {association.playbackType ?? "Automático"}
        </td>
        <td className="px-3 py-3">
          <Badge tone={RIGHTS_TONES[association.rightsStatus]}>
            {RIGHTS_LABELS[association.rightsStatus]}
          </Badge>
        </td>
        <td className="px-3 py-3">
          <Badge tone={AVAILABILITY_TONES[association.availabilityStatus]}>
            {AVAILABILITY_LABELS[association.availabilityStatus]}
          </Badge>
        </td>
        <td className="px-3 py-3 whitespace-nowrap">
          {formatDate(association.lastVerifiedAt)}
        </td>
        <td className="text-muted-foreground max-w-[16rem] px-3 py-3 text-xs break-words">
          {association.licenseReference ?? "—"}
        </td>
        <td className="px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              className="px-3 py-1.5"
              disabled={isBusy}
              onClick={handleVerify}
            >
              {isVerifying ? "Verificando..." : "Verificar agora"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="px-3 py-1.5"
              disabled={isBusy}
              aria-expanded={isEditingRights}
              onClick={() => setIsEditingRights((current) => !current)}
            >
              Direitos
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="px-3 py-1.5"
              disabled={isBusy}
              onClick={handleRemove}
            >
              {isRemoving ? "Removendo..." : "Remover"}
            </Button>
          </div>
          <div aria-live="polite" className="mt-2 text-xs">
            {result?.message && (
              <p className={result.ok ? "text-accent" : "text-danger"}>{result.message}</p>
            )}
          </div>
        </td>
      </tr>
      {isEditingRights && (
        <tr className="bg-surface/40">
          <td colSpan={9} className="px-3 py-4">
            <form
              onSubmit={handleSaveRights}
              className="flex max-w-3xl flex-col gap-3"
              noValidate
            >
              <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
                <Select
                  label="Status dos direitos"
                  value={rightsStatus}
                  onChange={(event) =>
                    setRightsStatus(event.target.value as AssociationView["rightsStatus"])
                  }
                  aria-describedby={rightsHelpId}
                >
                  {RIGHTS_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {RIGHTS_LABELS[status]}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Referência da licença"
                  value={licenseReference}
                  maxLength={500}
                  autoComplete="off"
                  placeholder="Licença, contrato ou URL oficial que comprova a autorização"
                  onChange={(event) => setLicenseReference(event.target.value)}
                  error={licenseError}
                />
              </div>
              <p id={rightsHelpId} className="text-muted-foreground text-xs">
                Marcar como <strong>Verificado</strong> é uma decisão sua: significa que
                você confirmou que há autorização para exibir este vídeo. Só títulos
                verificados (e disponíveis) são exibidos aos espectadores. Registre a
                prova da autorização na referência da licença.
              </p>
              <div className="flex gap-2">
                <Button type="submit" className="px-4 py-1.5" disabled={isSaving}>
                  {isSaving ? "Salvando..." : "Salvar direitos"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="px-4 py-1.5"
                  disabled={isSaving}
                  onClick={handleCancelRights}
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
