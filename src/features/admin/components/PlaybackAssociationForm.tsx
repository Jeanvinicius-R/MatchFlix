"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import {
  createAssociationAction,
  type PlaybackActionState,
} from "@/app/admin/playback/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { PLAYBACK_FORMATS } from "@/schemas/playback-association.schemas";

export interface PlaybackAdapterOption {
  id: string;
  label: string;
  assetIdHint: string;
}

interface PlaybackAssociationFormProps {
  adapters: PlaybackAdapterOption[];
}

type MediaTypeChoice = "MOVIE" | "EPISODE";

const FORMAT_LABELS: Record<(typeof PLAYBACK_FORMATS)[number], string> = {
  MP4: "MP4 (arquivo direto)",
  HLS: "HLS (streaming adaptativo)",
  DASH: "DASH (streaming adaptativo)",
  EMBED: "Embed (player do provedor)",
};

/** Empty input → undefined so the schema defaults/validation decide; never NaN. */
function toOptionalNumber(raw: FormDataEntryValue | null): number | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  return Number(raw);
}

function toOptionalText(raw: FormDataEntryValue | null): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function PlaybackAssociationForm({ adapters }: PlaybackAssociationFormProps) {
  const hintId = useId();
  const [isPending, startTransition] = useTransition();
  const [mediaType, setMediaType] = useState<MediaTypeChoice>("MOVIE");
  const [providerId, setProviderId] = useState(adapters[0]?.id ?? "");
  const [result, setResult] = useState<PlaybackActionState | null>(null);

  const selectedAdapter = adapters.find((adapter) => adapter.id === providerId);
  const fieldErrors: Record<string, string[]> = result?.fieldErrors ?? {};
  const firstError = (field: string) => fieldErrors[field]?.[0];
  const assetError = firstError("providerAssetId");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const isEpisode = mediaType === "EPISODE";

    // Client input is only a convenience; the action re-validates everything.
    const input = {
      tmdbId: toOptionalNumber(data.get("tmdbId")),
      mediaType,
      seasonNumber: isEpisode ? toOptionalNumber(data.get("seasonNumber")) : 0,
      episodeNumber: isEpisode ? toOptionalNumber(data.get("episodeNumber")) : 0,
      provider: providerId,
      providerAssetId: toOptionalText(data.get("providerAssetId")) ?? "",
      playbackType: toOptionalText(data.get("playbackType")),
      licenseReference: toOptionalText(data.get("licenseReference")),
    };

    startTransition(async () => {
      const outcome = await createAssociationAction(input);
      setResult(outcome);
      if (outcome.ok) {
        form.reset();
        setMediaType("MOVIE");
        setProviderId(adapters[0]?.id ?? "");
      }
    });
  }

  if (adapters.length === 0) {
    return (
      <p role="alert" className="text-danger text-sm">
        Nenhum provedor de reprodução está registrado, então não é possível cadastrar
        associações.
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border flex flex-col gap-4 rounded-md border p-4"
      noValidate
    >
      <h2 className="font-display text-foreground text-lg font-semibold">
        Nova associação
      </h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          label="ID do TMDB"
          name="tmdbId"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          required
          error={firstError("tmdbId")}
        />
        <Select
          label="Tipo"
          name="mediaType"
          value={mediaType}
          onChange={(event) => setMediaType(event.target.value as MediaTypeChoice)}
          error={firstError("mediaType")}
        >
          <option value="MOVIE">Filme</option>
          <option value="EPISODE">Episódio</option>
        </Select>
        {mediaType === "EPISODE" && (
          <>
            <Input
              label="Temporada"
              name="seasonNumber"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              defaultValue={1}
              error={firstError("seasonNumber")}
            />
            <Input
              label="Episódio"
              name="episodeNumber"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              defaultValue={1}
              error={firstError("episodeNumber")}
            />
          </>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Provedor"
          name="provider"
          value={providerId}
          onChange={(event) => setProviderId(event.target.value)}
          error={firstError("provider")}
        >
          {adapters.map((adapter) => (
            <option key={adapter.id} value={adapter.id}>
              {adapter.label}
            </option>
          ))}
        </Select>
        <div className="flex flex-col gap-1.5">
          <Input
            label="ID do vídeo no provedor"
            name="providerAssetId"
            maxLength={300}
            required
            autoComplete="off"
            error={assetError}
            {...(assetError ? {} : { "aria-describedby": hintId })}
          />
          {selectedAdapter && (
            <p id={hintId} className="text-muted-foreground text-xs">
              Formato esperado: {selectedAdapter.assetIdHint}
            </p>
          )}
        </div>
        <Select
          label="Formato (opcional)"
          name="playbackType"
          defaultValue=""
          error={firstError("playbackType")}
        >
          <option value="">Detectar automaticamente</option>
          {PLAYBACK_FORMATS.map((format) => (
            <option key={format} value={format}>
              {FORMAT_LABELS[format]}
            </option>
          ))}
        </Select>
        <Input
          label="Referência da licença (opcional)"
          name="licenseReference"
          maxLength={500}
          placeholder="Ex.: CC BY 3.0 — https://..."
          autoComplete="off"
          error={firstError("licenseReference")}
        />
      </div>

      <p className="text-muted-foreground text-xs">
        A associação sempre nasce como <strong>não verificada</strong> e não é exibida
        aos espectadores até que você confirme os direitos na tabela abaixo.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Cadastrando..." : "Cadastrar associação"}
        </Button>
        <div aria-live="polite" className="text-sm">
          {result?.message && (
            <p className={result.ok ? "text-accent" : "text-danger"}>{result.message}</p>
          )}
        </div>
      </div>
    </form>
  );
}
