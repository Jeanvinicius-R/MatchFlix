// Local provider mock for the e2e job: an Xtream-style panel and an M3U + HLS
// server, both requiring credentials, both serving the SAME real video (the
// Blender Foundation's "Big Buck Bunny", CC BY) that the job downloaded from the
// Internet Archive. It imitates the access pattern of a licensed operator server:
//
//   Xtream  /player_api.php?username=&password=&action=...   (JSON)
//           /movie/<user>/<pass>/<id>.mp4                      (MP4 with Range)
//   M3U     /list.m3u?username=&password=                      (playlist)
//           /hls/<user>/<pass>/master.m3u8, index.m3u8, segNNNN.ts
//
// It also counts what reached it (GET /__stats) so the test can prove that a
// revoked association stops BEFORE any byte is requested from the upstream, and
// that the proxy never forwards the browser's cookies.
//
// Env: MOCK_MEDIA_FILE (mp4), MOCK_HLS_DIR (master/index/segments), MOCK_PORT.

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "e2e-config.json"), "utf8"));
const { mock } = config;

const PORT = Number(process.env.MOCK_PORT ?? mock.port);
const MEDIA_FILE = resolve(process.env.MOCK_MEDIA_FILE ?? "e2e-out/bbb.mp4");
const HLS_DIR = resolve(process.env.MOCK_HLS_DIR ?? "e2e-out/hls");

const stats = {
  total: 0,
  xtreamApi: 0,
  xtreamMedia: 0,
  m3uList: 0,
  hls: 0,
  rejected: 0,
  cookieHeaders: 0,
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { "Content-Type": "application/json" });
}

/** "bytes=a-b" | "bytes=a-" | "bytes=-n" -> {start,end} or null (unsatisfiable/invalid). */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? "").trim());

  if (!match || (match[1] === "" && match[2] === "")) {
    return null;
  }

  let start;
  let end;

  if (match[1] === "") {
    const suffix = Number(match[2]);

    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }

  return start <= end && start < size ? { start, end } : null;
}

/** Serves a file with HEAD and Range support, like a normal static/CDN origin. */
function serveFile(req, res, file, contentType) {
  if (!existsSync(file)) {
    return send(res, 404, "not found", { "Content-Type": "text/plain" });
  }

  const size = statSync(file).size;
  const base = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };

  if (req.headers.range) {
    const range = parseRange(req.headers.range, size);

    if (!range) {
      res.writeHead(416, { ...base, "Content-Range": `bytes */${size}` });
      return res.end();
    }

    res.writeHead(206, {
      ...base,
      "Content-Length": range.end - range.start + 1,
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
    });

    if (req.method === "HEAD") {
      return res.end();
    }

    return createReadStream(file, { start: range.start, end: range.end }).pipe(res);
  }

  res.writeHead(200, { ...base, "Content-Length": size });

  if (req.method === "HEAD") {
    return res.end();
  }

  return createReadStream(file).pipe(res);
}

function entryUrl() {
  return `http://${mock.host}:${PORT}/hls/${mock.m3uUser}/${mock.m3uPass}/master.m3u8`;
}

function handleXtreamApi(url, res) {
  stats.xtreamApi += 1;

  if (
    url.searchParams.get("username") !== mock.xtreamUser ||
    url.searchParams.get("password") !== mock.xtreamPass
  ) {
    stats.rejected += 1;
    return sendJson(res, 401, { user_info: { auth: 0 } });
  }

  switch (url.searchParams.get("action")) {
    case "get_vod_info":
      if (url.searchParams.get("vod_id") !== "1") {
        return sendJson(res, 200, {});
      }

      return sendJson(res, 200, {
        info: { name: "Big Buck Bunny", releasedate: "2008-04-10" },
        movie_data: { stream_id: 1, name: "Big Buck Bunny", container_extension: "mp4" },
      });
    case "get_vod_streams":
      return sendJson(res, 200, [
        {
          num: 1,
          name: "Big Buck Bunny (2008)",
          stream_id: 1,
          tmdb: String(config.titles.archive.tmdbId),
          year: "2008",
          container_extension: "mp4",
        },
      ]);
    case "get_series":
      return sendJson(res, 200, []);
    case "get_series_info":
      return sendJson(res, 200, { episodes: {} });
    default:
      return sendJson(res, 200, { user_info: { auth: 1, status: "Active" } });
  }
}

const server = http.createServer((req, res) => {
  stats.total += 1;

  // The proxy must never forward the browser's cookies to an upstream.
  if (req.headers.cookie) {
    stats.cookieHeaders += 1;
  }

  const url = new URL(req.url ?? "/", `http://${mock.host}:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method !== "GET" && method !== "HEAD") {
    return send(res, 405, "method not allowed", { "Content-Type": "text/plain" });
  }

  if (path === "/__health") {
    return send(res, 200, "ok", { "Content-Type": "text/plain" });
  }

  if (path === "/__stats") {
    return sendJson(res, 200, stats);
  }

  if (path === "/player_api.php") {
    return handleXtreamApi(url, res);
  }

  // /movie/<user>/<pass>/1.mp4
  const movie = /^\/movie\/([^/]+)\/([^/]+)\/1\.mp4$/.exec(path);

  if (movie) {
    stats.xtreamMedia += 1;

    if (movie[1] !== mock.xtreamUser || movie[2] !== mock.xtreamPass) {
      stats.rejected += 1;
      return send(res, 401, "unauthorized", { "Content-Type": "text/plain" });
    }

    return serveFile(req, res, MEDIA_FILE, "video/mp4");
  }

  if (path === "/list.m3u") {
    stats.m3uList += 1;

    if (
      url.searchParams.get("username") !== mock.m3uUser ||
      url.searchParams.get("password") !== mock.m3uPass
    ) {
      stats.rejected += 1;
      return send(res, 401, "unauthorized", { "Content-Type": "text/plain" });
    }

    const playlist = [
      "#EXTM3U",
      `#EXTINF:-1 tvg-id="bbb" group-title="Filmes",Big Buck Bunny (2008)`,
      entryUrl(),
      "",
    ].join("\n");

    return send(res, 200, playlist, { "Content-Type": "audio/x-mpegurl" });
  }

  // /hls/<user>/<pass>/<file>
  const hls = /^\/hls\/([^/]+)\/([^/]+)\/([A-Za-z0-9_.-]+)$/.exec(path);

  if (hls) {
    stats.hls += 1;

    if (hls[1] !== mock.m3uUser || hls[2] !== mock.m3uPass) {
      stats.rejected += 1;
      return send(res, 401, "unauthorized", { "Content-Type": "text/plain" });
    }

    const name = hls[3];
    const file = join(HLS_DIR, name);

    if (name.endsWith(".m3u8")) {
      return serveFile(req, res, file, "application/vnd.apple.mpegurl");
    }

    if (name.endsWith(".ts")) {
      return serveFile(req, res, file, "video/mp2t");
    }

    return send(res, 404, "not found", { "Content-Type": "text/plain" });
  }

  return send(res, 404, "not found", { "Content-Type": "text/plain" });
});

server.listen(PORT, mock.host, () => {
  console.log(`mock-provider-server em http://${mock.host}:${PORT} (mp4: ${MEDIA_FILE}, hls: ${HLS_DIR})`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
