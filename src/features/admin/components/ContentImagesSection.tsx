"use client";

import { useState } from "react";
import { TmdbSearchPicker } from "@/features/admin/components/TmdbSearchPicker";
import { cn } from "@/lib/utils";

interface ApplyResult {
  formError?: string;
  saved?: boolean;
}

interface ContentImagesSectionProps {
  kind: "movie" | "series";
  contentId: string;
  contentTitle: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  /** Server Action that pulls the images of a TMDB title onto this content. */
  applyImages: (contentId: string, input: { tmdbId: number }) => Promise<ApplyResult>;
}

/* External TMDB thumbnails: not worth next/image remote config for an admin-only preview. */
function ImagePreview({
  url,
  label,
  className,
}: {
  url: string | null;
  label: string;
  className: string;
}) {
  return (
    <figure className="flex flex-col gap-1.5">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={label}
          loading="lazy"
          className={cn("rounded-md object-cover", className)}
        />
      ) : (
        <div
          className={cn(
            "border-border text-muted-foreground flex items-center justify-center rounded-md border border-dashed text-xs",
            className,
          )}
        >
          sem imagem
        </div>
      )}
      <figcaption className="text-muted-foreground text-xs">{label}</figcaption>
    </figure>
  );
}

export function ContentImagesSection({
  kind,
  contentId,
  contentTitle,
  posterUrl,
  backdropUrl,
  applyImages,
}: ContentImagesSectionProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  async function handlePick(tmdbId: number) {
    setIsBusy(true);
    setMessage(null);
    const result = await applyImages(contentId, { tmdbId });
    setIsBusy(false);
    setMessage(
      result.formError
        ? { text: result.formError, isError: true }
        : { text: "Imagens atualizadas.", isError: false },
    );
  }

  return (
    <section className="border-border flex flex-col gap-4 border-t pt-6">
      <div>
        <h2 className="font-display text-foreground text-lg font-semibold">Imagens</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Pôster e banner vêm da TMDB. Busque {kind === "movie" ? "o filme" : "a série"} «
          {contentTitle}» e escolha o resultado certo para aplicar as imagens.
        </p>
      </div>

      <div className="flex flex-wrap gap-6">
        <ImagePreview url={posterUrl} label="Pôster" className="aspect-[2/3] w-28" />
        <ImagePreview url={backdropUrl} label="Banner" className="aspect-video w-56" />
      </div>

      <TmdbSearchPicker type={kind} onPick={handlePick} disabled={isBusy} />

      {isBusy && <p className="text-muted-foreground text-xs">Aplicando imagens...</p>}
      {message && (
        <p
          role={message.isError ? "alert" : "status"}
          className={cn("text-sm", message.isError ? "text-danger" : "text-accent")}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
