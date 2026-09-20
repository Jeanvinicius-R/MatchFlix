"use client";

import { useState } from "react";
import {
  attachMovieVideoAction,
  removeMovieVideoAction,
} from "@/app/admin/movies/actions";
import { Button } from "@/components/ui/Button";
import {
  VideoSourcePicker,
  type PickedVideoSource,
  type VideoSourceProviderOption,
} from "@/features/admin/components/VideoSourcePicker";
import { cn } from "@/lib/utils";

interface MovieVideoSectionProps {
  movieId: string;
  movieTitle: string;
  providers: VideoSourceProviderOption[];
  currentVideo: { fileName: string | null; url: string } | null;
}

export function MovieVideoSection({
  movieId,
  movieTitle,
  providers,
  currentVideo,
}: MovieVideoSectionProps) {
  const [picked, setPicked] = useState<PickedVideoSource | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  function handlePick(next: PickedVideoSource | null) {
    setPicked(next);
    setFileName(next?.files[0]?.fileName ?? null);
    setMessage(null);
  }

  async function handleSave() {
    if (!picked || !fileName) {
      return;
    }
    setIsBusy(true);
    setMessage(null);

    const result = await attachMovieVideoAction(movieId, {
      provider: picked.providerId,
      itemId: picked.itemId,
      fileName,
    });
    setIsBusy(false);

    const firstFieldError = result.fieldErrors
      ? Object.values(result.fieldErrors)[0]?.[0]
      : undefined;
    const error = result.formError ?? firstFieldError;
    setMessage(
      error
        ? { text: error, isError: true }
        : { text: "Vídeo vinculado ao filme.", isError: false },
    );
  }

  async function handleRemove() {
    setIsBusy(true);
    setMessage(null);
    await removeMovieVideoAction(movieId);
    setIsBusy(false);
    setMessage({ text: "Vídeo removido.", isError: false });
  }

  return (
    <section className="border-border flex flex-col gap-4 border-t pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-foreground text-lg font-semibold">Vídeo</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {currentVideo
              ? `Atual: ${currentVideo.fileName ?? currentVideo.url}`
              : "Nenhum vídeo vinculado ainda."}
          </p>
        </div>
        {currentVideo && (
          <Button type="button" variant="ghost" onClick={handleRemove} disabled={isBusy}>
            Remover vídeo
          </Button>
        )}
      </div>

      <VideoSourcePicker
        providers={providers}
        initialQuery={movieTitle}
        onPick={handlePick}
      />

      {picked && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-foreground text-sm font-medium">Arquivo</legend>
          {picked.files.map((file) => (
            <label
              key={file.fileName}
              className="text-foreground flex items-center gap-2 text-sm"
            >
              <input
                type="radio"
                name="video-file"
                className="accent-accent"
                checked={fileName === file.fileName}
                onChange={() => setFileName(file.fileName)}
              />
              {file.label}
            </label>
          ))}
        </fieldset>
      )}

      {message && (
        <p
          role={message.isError ? "alert" : "status"}
          className={cn("text-sm", message.isError ? "text-danger" : "text-accent")}
        >
          {message.text}
        </p>
      )}

      <Button
        type="button"
        onClick={handleSave}
        disabled={isBusy || !picked || !fileName}
        className="w-full sm:w-auto"
      >
        {isBusy ? "Aguarde..." : "Vincular vídeo"}
      </Button>
    </section>
  );
}
