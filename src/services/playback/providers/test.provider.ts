import type {
  PlaybackContext,
  PlaybackProvider,
  PlaybackSource,
} from "../playback.types";

/**
 * TEMPORARY provider used only to exercise the playback chain end to end
 * (TMDB id -> provider -> API -> iframe). It serves a self-contained page
 * as a data: URL, so no third-party content or extra route is involved.
 * Remove it from `index.ts` once a real source is configured.
 */
function buildTestPage(title: string, details: string): string {
  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { height: 100%; margin: 0; }
      body {
        display: flex; flex-direction: column; align-items: center;
        justify-content: center; gap: 8px; text-align: center;
        background: #111; color: #eee; font-family: system-ui, sans-serif;
      }
      h1 { margin: 0; font-size: 1.4rem; }
      p { margin: 0; color: #9ca3af; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p>${details}</p>
  </body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export const testProvider: PlaybackProvider = {
  id: "test",
  label: "Test Provider",

  async getMovieSource(
    context: PlaybackContext
  ): Promise<PlaybackSource | null> {
    if (!context.tmdbId) {
      return null;
    }

    return {
      id: `test-movie-${context.tmdbId}`,
      provider: "test",
      type: "iframe",
      url: buildTestPage(
        "Player de teste do MatchFlix",
        `Filme com TMDB ID ${context.tmdbId}`
      ),
      label: "Teste",
    };
  },

  async getEpisodeSource(
    context: PlaybackContext
  ): Promise<PlaybackSource | null> {
    if (
      !context.tmdbId ||
      context.season === undefined ||
      context.episode === undefined
    ) {
      return null;
    }

    return {
      id: `test-episode-${context.tmdbId}-${context.season}-${context.episode}`,
      provider: "test",
      type: "iframe",
      url: buildTestPage(
        "Player de teste do MatchFlix",
        `Série com TMDB ID ${context.tmdbId} · T${context.season} E${context.episode}`
      ),
      label: "Teste",
    };
  },
};
