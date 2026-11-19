// HTTPS "embed provider" mock for the e2e job: a licensed player the operator
// may frame, keyed by TMDB id, in the URL shapes the EMBED adapter builds:
//
//   /embed/movie/<tmdbId>
//   /embed/tv/<tmdbId>/<season>/<episode>
//
// It plays the SAME real video as the other mocks (Big Buck Bunny, CC BY, from
// the Internet Archive) in a <video>, and only knows the TMDB ids listed in
// e2e-config.json, so an unknown title answers 404 like a real provider would.
//
//   /negado/<tmdbId>  -> same page but with X-Frame-Options: DENY (provider that
//                        forbids framing; the availability check must refuse it)
//   /media.mp4        -> the video (Range supported)
//   /__stats          -> what reached the server
//
// Env: MOCK_MEDIA_FILE (mp4), MOCK_TLS_KEY, MOCK_TLS_CERT (see make-tls.mjs).

import { createReadStream, readFileSync, statSync } from "node:fs";
import https from "node:https";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "e2e-config.json"), "utf8"));
const { mock, titles } = config;

const PORT = Number(process.env.MOCK_EMBED_PORT ?? mock.embedPort);
const MEDIA_FILE = resolve(process.env.MOCK_MEDIA_FILE ?? "e2e-out/bbb.mp4");
const KEY = readFileSync(process.env.MOCK_TLS_KEY ?? "e2e-out/tls/key.pem");
const CERT = readFileSync(process.env.MOCK_TLS_CERT ?? "e2e-out/tls/cert.pem");

// TMDB ids this provider has a player for.
const KNOWN = new Set([titles.embedMock.tmdbId, titles.embedSeries.tmdbId, titles.embedBlocked.tmdbId]);

const stats = { pages: 0, media: 0, notFound: 0, denied: 0, referers: [] };

function page(kind, tmdbId, season, episode) {
  const label = kind === "movie" ? `filme ${tmdbId}` : `série ${tmdbId} T${season}E${episode}`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Player ${label}</title>
<style>html,body{margin:0;height:100%;background:#000;color:#fff;font-family:sans-serif}video{width:100%;height:100%}</style></head>
<body data-kind="${kind}" data-tmdb="${tmdbId}" data-season="${season ?? ""}" data-episode="${episode ?? ""}">
<video id="v" src="/media.mp4" controls autoplay muted playsinline></video></body></html>`;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

const server = https.createServer({ key: KEY, cert: CERT }, (req, res) => {
  const url = new URL(req.url ?? "/", `https://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (path === "/__stats") {
    return send(res, 200, JSON.stringify(stats), { "Content-Type": "application/json" });
  }

  if (path === "/media.mp4") {
    stats.media += 1;

    const size = statSync(MEDIA_FILE).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));

    if (range && (range[1] !== "" || range[2] !== "")) {
      const start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
      const end = range[1] === "" || range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);

      if (start > end || start >= size) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` });
        return res.end();
      }

      res.writeHead(206, {
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": end - start + 1,
      });
      return createReadStream(MEDIA_FILE, { start, end }).pipe(res);
    }

    res.writeHead(200, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": size });
    return createReadStream(MEDIA_FILE).pipe(res);
  }

  const movie = /^\/(embed|negado)\/movie\/(\d+)$/.exec(path) ?? /^\/(negado)\/(\d+)$/.exec(path);
  const episode = /^\/embed\/tv\/(\d+)\/(\d+)\/(\d+)$/.exec(path);

  if (movie || episode) {
    stats.pages += 1;

    if (req.headers.referer) {
      stats.referers.push(req.headers.referer);
    }

    const tmdbId = Number(movie ? movie[2] : episode[1]);

    if (!KNOWN.has(tmdbId)) {
      stats.notFound += 1;
      return send(res, 404, "título não encontrado", { "Content-Type": "text/plain" });
    }

    const headers = { "Content-Type": "text/html; charset=utf-8" };

    if (movie && movie[1] === "negado") {
      stats.denied += 1;
      headers["X-Frame-Options"] = "DENY";
    }

    return send(
      res,
      200,
      movie ? page("movie", tmdbId) : page("tv", tmdbId, Number(episode[2]), Number(episode[3])),
      headers,
    );
  }

  return send(res, 404, "not found", { "Content-Type": "text/plain" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-embed-server em https://127.0.0.1:${PORT} (mp4: ${MEDIA_FILE})`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
