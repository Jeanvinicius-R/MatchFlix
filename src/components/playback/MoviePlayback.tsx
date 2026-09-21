"use client";

import { useEffect, useState } from "react";
import PlaybackPlayer from "./PlaybackPlayer";
import type { PlaybackSource } from "@/services/playback/playback.types";

interface MoviePlaybackProps {
  tmdbId: number;
}

export default function MoviePlayback({
  tmdbId,
}: MoviePlaybackProps) {
  const [sources, setSources] = useState<PlaybackSource[]>([]);
  const [selectedSource, setSelectedSource] =
    useState<PlaybackSource | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSources() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `/api/playback/movie/${tmdbId}`
        );

        if (!response.ok) {
          throw new Error(
            "Não foi possível carregar as fontes"
          );
        }

        const data = await response.json();

        setSources(data.sources ?? []);

        if (data.sources?.length > 0) {
          setSelectedSource(data.sources[0]);
        }
      } catch (err) {
        console.error(err);

        setError(
          "Não foi possível carregar o vídeo."
        );
      } finally {
        setLoading(false);
      }
    }

    loadSources();
  }, [tmdbId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center aspect-video bg-black">
        <p>Carregando vídeo...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center aspect-video bg-black">
        <p>{error}</p>
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <div className="flex items-center justify-center aspect-video bg-black">
        <p>Nenhuma fonte disponível.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {selectedSource && (
        <PlaybackPlayer source={selectedSource} />
      )}

      {sources.length > 1 && (
        <div className="flex gap-2">
          {sources.map((source) => (
            <button
              key={source.id}
              onClick={() => setSelectedSource(source)}
              className="px-4 py-2 rounded bg-zinc-800"
            >
              {source.label ?? source.provider}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}