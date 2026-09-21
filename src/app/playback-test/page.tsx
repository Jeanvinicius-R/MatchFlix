import MoviePlayback from "@/components/playback/MoviePlayback";

/** TEMPORARY page used only to check the playback chain visually. */
export default function PlaybackTestPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">Teste do Playback</h1>
      <p className="text-zinc-400">
        Página temporária que renderiza o MoviePlayback com o TMDB ID 123 e
        mostra o iframe gerado pelo provider de teste.
      </p>

      <MoviePlayback tmdbId={123} />
    </main>
  );
}
