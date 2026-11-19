// End-to-end proof in REAL Google Chrome: TMDB title -> local movie -> verified
// association -> provider API -> playback URL -> player -> video playing.
//
// Run by .github/workflows/playback-live.yml (job e2e-chrome) against the built
// Next server, the seeded database (scripts/e2e-seed.ts) and the local provider
// mock (e2e/mock-provider-server.mjs). Needs: playwright-core, pg, ffmpeg.
//
// Scenarios (kind -> what it proves):
//   archive      direct playback from archive.org (no proxy)            L1..L4 + L5-c
//   xtream-mock  MP4 with credentials in the URL, via the proxy (Range)  L1..L4
//   m3u-mock     HLS with credentials in the path, rewritten + hls.js    L1..L4
//   peertube-e2e a REAL PeerTube video found at run time                L1..L4 (+L5)
//   no-association / unverified  -> "INDISPONÍVEL PARA REPRODUÇÃO"
//   revoked      association revoked mid-playback -> proxy 410, player error
//   blocked      server on 127.0.0.1 without allowPrivateNetwork -> refused
//   tmdb         real TMDB catalog (only with TMDB_ACCESS_TOKEN)
//   reverify     POST /api/internal/reverify (CRON_SECRET)
//
// Exit code 1 when a required scenario fails.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { chromium, request as playwrightRequest } from "playwright-core";
import { newRow, renderMarkdown } from "./report-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, "e2e-config.json"), "utf8"));
const OUT = "e2e-out";
const SHOTS = join(OUT, "screenshots");
const BASE_URL = process.env.E2E_BASE_URL ?? cfg.baseUrl;
const MOCK_ORIGIN = `http://${cfg.mock.host}:${cfg.mock.port}`;
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const HAS_TMDB = Boolean(process.env.TMDB_ACCESS_TOKEN);
const SECRETS = [cfg.mock.xtreamUser, cfg.mock.xtreamPass, cfg.mock.m3uUser, cfg.mock.m3uPass];
const USER_AGENT = "MatchFlix-E2E/1.0";
const JOB = "e2e-chrome";

mkdirSync(SHOTS, { recursive: true });

const seed = JSON.parse(readFileSync(join(OUT, "seed.json"), "utf8"));
const adapterChecks = existsSync(join(OUT, "adapter-checks.json"))
  ? JSON.parse(readFileSync(join(OUT, "adapter-checks.json"), "utf8"))
  : [];

const rows = [];
const consoleLog = [];
const leaks = [];

function log(message) {
  console.log(message);
}

function addRow(options) {
  const row = newRow({ ...options, job: JOB });

  rows.push(row);
  log(`\n== ${row.scenario}`);
  return row;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function containsSecret(text) {
  return SECRETS.some((secret) => text.includes(secret));
}

function errorText(error) {
  return error instanceof Error ? error.message.split("\n")[0].slice(0, 300) : String(error);
}

// ---------------------------------------------------------------------------
// Processes (ffprobe / ffmpeg)
// ---------------------------------------------------------------------------

function runCommand(command, args, timeoutMs, onLine) {
  return new Promise((resolve) => {
    let stderr = "";
    let stdout = "";
    let carry = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    function finish(result) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    }

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");

      if (!onLine) {
        stdout = (stdout + text).slice(-200_000);
        return;
      }

      const lines = (carry + text).split("\n");

      carry = lines.pop() ?? "";
      lines.forEach((line) => onLine(line.trim()));
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4000);
    });
    child.on("error", (error) => finish({ code: null, stdout, stderr, timedOut, spawnError: error.message }));
    child.on("close", (code) => {
      if (onLine && carry.trim() !== "") {
        onLine(carry.trim());
      }

      finish({ code, stdout, stderr, timedOut });
    });
  });
}

/** ffprobe duration in seconds, or null. */
async function ffprobeDuration(url) {
  const result = await runCommand(
    "ffprobe",
    ["-v", "error", "-user_agent", USER_AGENT, "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", url],
    120_000,
  );
  const seconds = Number(result.stdout.trim());

  return result.code === 0 && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * ffmpeg decode into the null muxer. `limitSeconds` set = L3 (10 s); unset = the
 * WHOLE media (L5-b). Any ffmpeg error output counts as a failure.
 * `headers` is a raw "-headers" value (the session cookie, to go through the proxy).
 */
/**
 * ffmpeg's HLS demuxer reads only the FIRST segment of a playlist made of one
 * fragmented MP4 with #EXT-X-MAP + #EXT-X-BYTERANGE (PeerTube's format) and still
 * exits successfully, so a "full decode" stops after ~6 s. Every segment of such a
 * playlist is a contiguous byte range of ONE file, so that file is the whole video:
 * decode it directly. Null when the playlist has another shape (or is not public).
 */
async function singleFmp4OfHls(url) {
  if (!/\.m3u8(?:[?#]|$)/i.test(url)) {
    return null;
  }

  const fetchText = async (target) => {
    try {
      const response = await fetch(target, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) });

      return response.ok ? await response.text() : null;
    } catch {
      return null;
    }
  };

  const master = await fetchText(url);

  if (master === null) {
    return null;
  }

  let mediaUrl = url;
  let media = master;

  if (master.includes("#EXT-X-STREAM-INF")) {
    // Lowest bandwidth: the same video, the smallest download.
    const lines = master.split(/\r?\n/);
    let best = null;

    for (let index = 0; index < lines.length - 1; index += 1) {
      const match = /^#EXT-X-STREAM-INF:.*?\bBANDWIDTH=(\d+)/.exec(lines[index]);
      const uri = lines[index + 1]?.trim();

      if (match && uri && !uri.startsWith("#") && (best === null || Number(match[1]) < best.bandwidth)) {
        best = { bandwidth: Number(match[1]), uri };
      }
    }

    if (!best) {
      return null;
    }

    mediaUrl = new URL(best.uri, url).toString();
    media = await fetchText(mediaUrl);

    if (media === null) {
      return null;
    }
  }

  if (!media.includes("#EXT-X-MAP") || !media.includes("#EXT-X-BYTERANGE")) {
    return null;
  }

  const files = new Set(media.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#")));
  const mapUri = /#EXT-X-MAP:.*?URI="([^"]+)"/.exec(media)?.[1];

  return files.size === 1 && mapUri && files.has(mapUri) ? new URL(mapUri, mediaUrl).toString() : null;
}

const FLATTENED_NOTE =
  "decodificado a partir do arquivo fMP4 único da variante HLS (o demuxer HLS do ffmpeg só lê o 1º segmento deste formato; os segmentos são faixas contíguas desse arquivo)";

async function ffmpegDecode(url, { limitSeconds, minSeconds, timeoutMs, headers, hls = false }) {
  const args = ["-v", "error", "-nostdin", "-nostats", "-progress", "pipe:1", "-user_agent", USER_AGENT];

  if (hls) {
    // The proxy URLs of the segments have no file extension (ffmpeg >= 5.1 refuses them unless told otherwise).
    args.push(
      "-allowed_extensions",
      "ALL",
      "-extension_picky",
      "0",
      "-protocol_whitelist",
      "file,http,https,tcp,tls,crypto",
    );
  }

  const flattened = headers ? null : await singleFmp4OfHls(url);
  const note = flattened ? FLATTENED_NOTE : undefined;

  if (flattened) {
    url = flattened;
  }

  if (headers) {
    args.push("-headers", headers);
  }

  if (limitSeconds !== undefined) {
    args.push("-t", String(limitSeconds));
  }

  args.push("-i", url, "-f", "null", "-");

  let decoded = 0;
  const result = await runCommand("ffmpeg", args, timeoutMs, (line) => {
    const match = /^out_time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(line);

    if (match) {
      decoded = Math.max(decoded, Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
    }
  });

  if (result.spawnError) {
    return { ok: false, decoded, note, reason: `ffmpeg indisponível (${result.spawnError})` };
  }

  if (result.timedOut) {
    return { ok: false, decoded, note, reason: "ffmpeg excedeu o tempo limite" };
  }

  if (result.code !== 0 || result.stderr.trim() !== "") {
    return { ok: false, decoded, note, reason: `ffmpeg: ${result.stderr.trim().slice(0, 250) || `código ${result.code}`}` };
  }

  if (decoded < minSeconds) {
    return { ok: false, decoded, note, reason: `decodificou só ${decoded.toFixed(1)} s (mínimo ${minSeconds.toFixed(1)} s)` };
  }

  return { ok: true, decoded, note };
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

async function readHead(response, maxBytes) {
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    chunks.push(Buffer.from(value));
    total += value.byteLength;

    if (total >= maxBytes) {
      await reader.cancel();
      break;
    }
  }

  return Buffer.concat(chunks).subarray(0, maxBytes);
}

const isoBox = (head, names) => head.length >= 12 && names.includes(head.subarray(4, 8).toString("latin1"));

/** L2 against a public URL (no session): Range 206/200 + video content-type + ftyp. */
async function probePublicRange(url) {
  const response = await fetch(url, {
    headers: { Range: "bytes=0-1048575", "User-Agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
  });
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const head = await readHead(response, 1024 * 1024);
  const ok =
    (response.status === 206 || response.status === 200) &&
    contentType.startsWith("video/") &&
    isoBox(head, ["ftyp"]);

  return { ok, detail: `HTTP ${response.status}, ${contentType || "sem content-type"}, ftyp=${isoBox(head, ["ftyp"])}` };
}

/** First URI line of a playlist (variant or segment), resolved against `base`. */
function firstUri(playlist, base) {
  for (const line of playlist.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed !== "" && !trimmed.startsWith("#")) {
      return new URL(trimmed, base).toString();
    }
  }

  return null;
}

/** L2 for a public HLS source: master/media playlist, then the first segment. */
async function probePublicHls(masterUrl) {
  const fetchText = async (url) => {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });

    return response.ok ? response.text() : null;
  };

  const master = await fetchText(masterUrl);

  if (!master?.trimStart().startsWith("#EXTM3U")) {
    return { ok: false, detail: "o manifesto não começa com #EXTM3U" };
  }

  let mediaUrl = masterUrl;
  let media = master;

  if (master.includes("#EXT-X-STREAM-INF")) {
    mediaUrl = firstUri(master, masterUrl) ?? masterUrl;
    media = (await fetchText(mediaUrl)) ?? "";
  }

  const segmentUrl = firstUri(media, mediaUrl);

  if (!segmentUrl) {
    return { ok: false, detail: "a playlist de mídia não tem segmentos" };
  }

  const response = await fetch(segmentUrl, {
    headers: { Range: "bytes=0-1048575", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(45_000),
  });
  const head = await readHead(response, 1024 * 1024);
  const ok =
    (response.status === 200 || response.status === 206) &&
    (head[0] === 0x47 || isoBox(head, ["ftyp", "styp", "moof", "moov"]));

  return { ok, detail: `manifesto ok, 1º segmento HTTP ${response.status}` };
}

async function mockStats() {
  const response = await fetch(`${MOCK_ORIGIN}/__stats`, { signal: AbortSignal.timeout(10_000) });

  return response.json();
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

async function readVideo(page) {
  return page.evaluate(() => {
    const video = document.querySelector("video");

    if (!video) {
      return null;
    }

    return {
      readyState: video.readyState,
      width: video.videoWidth,
      height: video.videoHeight,
      currentTime: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : null,
      paused: video.paused,
      ended: video.ended,
      rate: video.playbackRate,
      src: video.currentSrc,
      error: video.error ? { code: video.error.code, message: video.error.message } : null,
    };
  });
}

/** The player's error overlay and the "could not load" placeholder both have this button. */
async function playerErrorVisible(page) {
  return page.getByRole("button", { name: "Tentar de novo" }).first().isVisible();
}

async function startVideo(page, playbackRate = 1) {
  await page.waitForSelector("video", { timeout: 90_000 });
  // With hls.js the element has no source yet (it is attached after a dynamic
  // import), so a single play() can be aborted: keep nudging until it runs.
  await page
    .waitForFunction(
      (rate) => {
        const video = document.querySelector("video");

        if (!video) {
          return false;
        }

        video.muted = true;
        video.playbackRate = rate;

        if (video.paused) {
          video.play().catch(() => undefined);
        }

        return video.currentSrc !== "" && !video.paused;
      },
      playbackRate,
      { polling: 500, timeout: 90_000 },
    )
    .catch(() => undefined);
}

/**
 * L4: the <video> reaches readyState >= 3, has a picture (videoWidth > 0), its
 * currentTime advances >= 3 s and no media error / error overlay shows up.
 */
async function proveChromePlayback(page, row, shotName) {
  await startVideo(page);

  try {
    await page.waitForFunction(
      () => {
        const video = document.querySelector("video");

        return Boolean(video) && video.readyState >= 3 && video.videoWidth > 0;
      },
      undefined,
      { timeout: 90_000 },
    );
  } catch {
    const state = await readVideo(page);

    row.levels.L4 = "fail";
    row.notes.push(`L4: o vídeo não chegou a readyState>=3 com imagem (${JSON.stringify(state)}).`);
    await page.screenshot({ path: join(SHOTS, `${shotName}-falha.png`) }).catch(() => undefined);
    return null;
  }

  const first = await readVideo(page);

  try {
    await page.waitForFunction(
      (start) => {
        const video = document.querySelector("video");

        return Boolean(video) && video.currentTime >= start + 3;
      },
      first.currentTime,
      { timeout: 60_000 },
    );
  } catch {
    row.levels.L4 = "fail";
    row.notes.push(`L4: currentTime não avançou 3 s (${JSON.stringify(await readVideo(page))}).`);
    await page.screenshot({ path: join(SHOTS, `${shotName}-falha.png`) }).catch(() => undefined);
    return null;
  }

  const state = await readVideo(page);
  const overlay = await playerErrorVisible(page);
  const ok = state.readyState >= 3 && state.width > 0 && state.error === null && !overlay;

  row.levels.L4 = ok ? "pass" : "fail";
  row.notes.push(
    ok
      ? `L4: ${state.src.startsWith("blob:") ? "hls.js (MSE)" : "reprodução nativa"}, readyState>=3, ${state.width}x${state.height}, currentTime ${first.currentTime.toFixed(1)}->${state.currentTime.toFixed(1)} s, sem erro de mídia.`
      : `L4: ${JSON.stringify(state)} (overlay de erro: ${overlay}).`,
  );
  row.video = {
    ...(row.video ?? { title: row.scenario, source: row.kind }),
    durationSeconds: state.duration ?? undefined,
    playedSeconds: state.currentTime,
  };
  await page.screenshot({ path: join(SHOTS, `${shotName}.png`) }).catch(() => undefined);

  return ok ? state : null;
}

/**
 * L5-c: the Chrome plays to the "ended" event (muted, playbackRate 16), ends
 * within 1 s of the duration without a media error, and the progress row of the
 * profile is saved as completed.
 */
async function proveChromeToTheEnd(page, row, movieId, shotName) {
  await startVideo(page, 16);

  try {
    await page.waitForFunction(
      () => {
        const video = document.querySelector("video");

        return Boolean(video) && (video.ended || video.error !== null);
      },
      undefined,
      { polling: 1000, timeout: 10 * 60_000 },
    );
  } catch {
    row.l5.c = "fail";
    row.notes.push(`L5-c: o vídeo não terminou a tempo (${JSON.stringify(await readVideo(page))}).`);
    return;
  }

  const end = await readVideo(page);
  const reachedEnd =
    end.ended && end.error === null && end.duration !== null && end.currentTime >= end.duration - 1;

  row.video = {
    ...(row.video ?? { title: row.scenario, source: row.kind }),
    durationSeconds: end.duration ?? row.video?.durationSeconds,
    playedSeconds: end.currentTime,
  };

  if (!reachedEnd) {
    row.l5.c = "fail";
    row.notes.push(`L5-c: não chegou ao fim sem erro (${JSON.stringify(end)}).`);
    return;
  }

  // The player saves progress on "ended"; give the server action a moment.
  let completed = false;
  let saved = null;

  for (let attempt = 0; attempt < 30 && !completed; attempt += 1) {
    const result = await db.query(
      'select "completed", "positionInSeconds", "durationInSeconds" from "WatchProgress" where "profileId" = $1 and "movieId" = $2',
      [seed.profileId, movieId],
    );

    saved = result.rows[0] ?? null;
    completed = saved?.completed === true;

    if (!completed) {
      await sleep(1000);
    }
  }

  row.l5.c = completed ? "pass" : "fail";
  row.notes.push(
    completed
      ? `L5-c: ended em ${end.currentTime.toFixed(1)}/${end.duration.toFixed(1)} s (16x) e o progresso foi gravado como concluído (${saved.positionInSeconds}/${saved.durationInSeconds} s).`
      : `L5-c: chegou ao fim, mas o progresso NÃO ficou como concluído (${JSON.stringify(saved)}).`,
  );
  await page.screenshot({ path: join(SHOTS, `${shotName}-fim.png`) }).catch(() => undefined);
}

async function fetchSources(context, tmdbId) {
  const response = await context.request.get(`/api/playback/movie/${tmdbId}`);
  const text = await response.text();
  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { status: response.status(), text, json, sources: Array.isArray(json?.sources) ? json.sources : [] };
}

async function sessionCookieHeader(context) {
  const cookies = await context.cookies(BASE_URL);

  return `Cookie: ${cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")}\r\n`;
}

async function checkAvailability(context, tmdbId, live) {
  const response = await context.request.get(
    `/api/playback/availability?tmdbId=${tmdbId}&type=movie${live ? "&check=1" : ""}`,
  );

  return { status: response.status(), json: await response.json().catch(() => null) };
}

async function expectUnavailableScreen(page, slug) {
  await page.goto(`/watch/${slug}`, { waitUntil: "domcontentloaded" });

  try {
    await page.getByText("INDISPONÍVEL PARA REPRODUÇÃO").waitFor({ state: "visible", timeout: 45_000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
let browser;
let context;

async function login(page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("E-mail").fill(seed.admin.email);
  await page.getByLabel("Senha").fill(seed.admin.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  // login -> /profiles -> /profiles/select/<id> (sets the profile cookie) -> /
  await page.waitForURL((url) => url.pathname === "/", { timeout: 90_000 });
}

/** The proxied-media scenarios share the same L1/L2/L3 shape. */
async function proveProxiedSource(row, tmdbId, kind) {
  const { status, text, json, sources } = await fetchSources(context, tmdbId);
  const source = sources[0];
  const expectedProvider = kind === "mp4" ? "xtream-mock" : "m3u-mock";

  // L1: valid JSON, a source of the right provider, the proxy path, no credentials / upstream URL.
  const proxyPath = typeof source?.url === "string" ? source.url : "";
  const clean = !containsSecret(text) && !text.includes(MOCK_ORIGIN) && !text.includes("127.0.0.1");
  const l1 =
    status === 200 &&
    json !== null &&
    source?.provider === expectedProvider &&
    /^\/api\/playback\/proxy\/[A-Za-z0-9_-]{16,}$/.test(proxyPath) &&
    clean;

  row.levels.L1 = l1 ? "pass" : "fail";
  row.notes.push(
    l1
      ? `L1: /api/playback/movie/${tmdbId} -> ${source.provider}/${source.type} via proxy; sem credenciais nem URL do servidor no JSON.`
      : `L1: HTTP ${status}, provider=${source?.provider}, url=${proxyPath.slice(0, 40)}, limpo=${clean}.`,
  );

  if (!l1) {
    return null;
  }

  // L2
  if (kind === "mp4") {
    const response = await context.request.get(proxyPath, { headers: { Range: "bytes=0-1048575" } });
    const body = await response.body();
    const headers = response.headers();
    const ok =
      response.status() === 206 &&
      (headers["content-type"] ?? "").startsWith("video/") &&
      isoBox(body, ["ftyp"]) &&
      (headers["content-range"] ?? "").startsWith("bytes 0-") &&
      !("set-cookie" in headers) &&
      (headers["cache-control"] ?? "").includes("no-store");

    row.levels.L2 = ok ? "pass" : "fail";
    row.notes.push(
      `L2: proxy Range -> HTTP ${response.status()}, ${headers["content-type"]}, content-range=${headers["content-range"]}, ftyp=${isoBox(body, ["ftyp"])}.`,
    );
  } else {
    const manifestResponse = await context.request.get(proxyPath);
    const manifest = await manifestResponse.text();
    const uris = manifest.split(/\r?\n/).filter((line) => line.trim() !== "" && !line.startsWith("#"));
    let ok =
      manifestResponse.status() === 200 &&
      manifest.startsWith("#EXTM3U") &&
      uris.length > 0 &&
      uris.every((uri) => uri.startsWith("/api/playback/proxy/")) &&
      !containsSecret(manifest) &&
      !manifest.includes("127.0.0.1");
    let detail = `manifesto master HTTP ${manifestResponse.status()}, ${uris.length} URI(s) reescritas`;

    if (ok) {
      // master -> variant -> first segment, every hop through the proxy.
      let playlistText = manifest;

      if (manifest.includes("#EXT-X-STREAM-INF")) {
        const variant = await context.request.get(uris[0]);

        playlistText = await variant.text();
        ok = variant.status() === 200 && !containsSecret(playlistText) && playlistText.startsWith("#EXTM3U");
      }

      const segmentUri = playlistText.split(/\r?\n/).find((line) => line.trim() !== "" && !line.startsWith("#"));

      if (ok && segmentUri) {
        const segment = await context.request.get(segmentUri, { headers: { Range: "bytes=0-1048575" } });
        const bytes = await segment.body();

        ok = (segment.status() === 200 || segment.status() === 206) && bytes[0] === 0x47;
        detail += `, 1º segmento HTTP ${segment.status()} (sync TS 0x47: ${bytes[0] === 0x47})`;
      } else {
        ok = false;
      }
    }

    row.levels.L2 = ok ? "pass" : "fail";
    row.notes.push(`L2: ${detail}.`);
  }

  // The proxy is not reachable without the session of the user the token was minted for.
  const anonymous = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const anonymousResponse = await anonymous.get(proxyPath);

  await anonymous.dispose();
  row.notes.push(`Sem sessão, o proxy responde HTTP ${anonymousResponse.status()} (esperado 401).`);

  if (anonymousResponse.status() !== 401) {
    row.levels.L2 = "fail";
  }

  // L3: ffmpeg decodes 10 s THROUGH the proxy, authenticated by the session cookie.
  const decode = await ffmpegDecode(`${BASE_URL}${proxyPath}`, {
    limitSeconds: 10,
    minSeconds: 9,
    timeoutMs: 3 * 60_000,
    headers: await sessionCookieHeader(context),
    hls: kind === "hls",
  });

  row.levels.L3 = decode.ok ? "pass" : "fail";
  row.notes.push(decode.ok ? `L3: ffmpeg decodificou ${decode.decoded.toFixed(1)} s pelo proxy.` : `L3: ${decode.reason}.`);

  return proxyPath;
}

async function scenarioArchive(page) {
  const title = seed.titles.archive;
  const row = addRow({
    key: "archive:BigBuckBunny_124",
    scenario: "Internet Archive — Big Buck Bunny (BigBuckBunny_124) no MatchFlix",
    kind: "Archive direto",
  });

  row.video = { title: "Big Buck Bunny", source: "archive.org/details/BigBuckBunny_124" };

  // TMDB id -> Movie -> association -> adapter -> playback URL.
  const { status, json, sources, text } = await fetchSources(context, title.tmdbId);
  const source = sources[0];
  const l1 =
    status === 200 &&
    json !== null &&
    source?.provider === "archive" &&
    typeof source.url === "string" &&
    source.url.startsWith("https://archive.org/download/BigBuckBunny_124/") &&
    /CC BY/.test(source.attribution?.license ?? "") &&
    !containsSecret(text);

  row.levels.L1 = l1 ? "pass" : "fail";
  row.notes.push(
    l1
      ? `L1: TMDB ${title.tmdbId} -> associação VERIFIED -> adapter archive -> ${new URL(source.url).pathname} (${source.attribution.license}).`
      : `L1: HTTP ${status}, fonte=${JSON.stringify(source)?.slice(0, 200)}.`,
  );

  const availability = await checkAvailability(context, title.tmdbId, true);

  row.notes.push(
    `Disponibilidade ao vivo: estado ${availability.json?.state}, checkedLive=${availability.json?.checkedLive}.`,
  );

  if (availability.json?.state !== "CONFIRMED") {
    row.levels.L1 = "fail";
  }

  if (!l1) {
    return;
  }

  const range = await probePublicRange(source.url);

  row.levels.L2 = range.ok ? "pass" : "fail";
  row.notes.push(`L2: ${range.detail}.`);

  const decode = await ffmpegDecode(source.url, { limitSeconds: 10, minSeconds: 9, timeoutMs: 3 * 60_000 });

  row.levels.L3 = decode.ok ? "pass" : "fail";
  row.notes.push(decode.ok ? `L3: ffmpeg decodificou ${decode.decoded.toFixed(1)} s.` : `L3: ${decode.reason}.`);

  await page.goto(`/watch/${title.slug}`, { waitUntil: "domcontentloaded" });

  const played = await proveChromePlayback(page, row, "archive");

  if (played) {
    await proveChromeToTheEnd(page, row, title.movieId, "archive");
  } else {
    row.l5.c = "fail";
  }
}

async function scenarioProxied(page, options) {
  const title = seed.titles[options.titleKey];
  const row = addRow({
    key: options.key,
    scenario: options.scenario,
    kind: options.kind,
  });

  row.video = { title: "Big Buck Bunny", source: options.source };

  const availability = await checkAvailability(context, title.tmdbId, true);

  row.notes.push(
    `Disponibilidade ao vivo: estado ${availability.json?.state}, checkedLive=${availability.json?.checkedLive}.`,
  );

  const proxyPath = await proveProxiedSource(row, title.tmdbId, options.proxyKind);

  if (availability.json?.state !== "CONFIRMED") {
    row.levels.L1 = "fail";
  }

  if (!proxyPath) {
    return;
  }

  await page.goto(`/watch/${title.slug}`, { waitUntil: "domcontentloaded" });
  await proveChromePlayback(page, row, options.key);
}

async function scenarioPeerTube(page) {
  const found = seed.peertube?.found === true;
  const row = addRow({
    key: "peertube-e2e",
    scenario: "PeerTube real (instância descoberta em runtime) no MatchFlix",
    kind: "PeerTube direto",
    required: false,
  });

  if (!found) {
    row.levels = { L1: "skip", L2: "skip", L3: "skip", L4: "skip" };
    row.l5 = { a: "skip", b: "skip", c: "skip" };
    row.notes.push(`pulado: ${seed.peertube?.reason ?? "nenhum vídeo PeerTube encontrado"}.`);
    return;
  }

  const pt = seed.peertube;

  row.video = { title: pt.title, source: `${pt.assetId} (${pt.type})`, durationSeconds: pt.durationSeconds };

  const { status, sources, text } = await fetchSources(context, pt.tmdbId);
  const source = sources[0];
  const l1 =
    status === 200 &&
    source?.provider === "peertube" &&
    typeof source.url === "string" &&
    source.url.startsWith("https://") &&
    !containsSecret(text);

  row.levels.L1 = l1 ? "pass" : "fail";
  row.notes.push(l1 ? `L1: ${pt.assetId} -> ${source.type}.` : `L1: HTTP ${status}, fonte=${JSON.stringify(source)?.slice(0, 200)}.`);

  if (!l1) {
    return;
  }

  const reachable = source.type === "hls" ? await probePublicHls(source.url) : await probePublicRange(source.url);

  row.levels.L2 = reachable.ok ? "pass" : "fail";
  row.notes.push(`L2: ${reachable.detail}.`);

  const decode = await ffmpegDecode(source.url, { limitSeconds: 10, minSeconds: 9, timeoutMs: 3 * 60_000 });

  row.levels.L3 = decode.ok ? "pass" : "fail";
  row.notes.push(decode.ok ? `L3: ffmpeg decodificou ${decode.decoded.toFixed(1)} s.` : `L3: ${decode.reason}.`);
  if (decode.note) {
    row.notes.push(`L3: ${decode.note}.`);
  }

  // L5-a / L5-b on this very video (short enough for the CI).
  const probed = await ffprobeDuration(source.url);

  row.l5.a = probed !== null && probed >= pt.durationSeconds * 0.95 ? "pass" : "fail";
  row.notes.push(`L5-a: ffprobe ${probed === null ? "falhou" : `${probed.toFixed(1)} s`} (esperado >= ${(pt.durationSeconds * 0.95).toFixed(1)} s).`);

  if (probed !== null) {
    const full = await ffmpegDecode(source.url, {
      minSeconds: probed - 2,
      timeoutMs: 15 * 60_000,
    });

    row.l5.b = full.ok ? "pass" : "fail";
    row.notes.push(full.ok ? `L5-b: decodificação completa ${full.decoded.toFixed(1)} s sem erros.` : `L5-b: ${full.reason}.`);
    if (full.note) {
      row.notes.push(`L5-b: ${full.note}.`);
    }
  } else {
    row.l5.b = "fail";
  }

  await page.goto(`/watch/${pt.slug}`, { waitUntil: "domcontentloaded" });

  const played = await proveChromePlayback(page, row, "peertube");

  if (played) {
    await proveChromeToTheEnd(page, row, pt.movieId, "peertube");
  } else {
    row.l5.c = "fail";
  }
}

async function scenarioUnavailable(page, key, titleKey, scenario, extra) {
  const title = seed.titles[titleKey];
  const row = addRow({ key, scenario, kind: "Sem fonte reproduzível" });
  const shown = await expectUnavailableScreen(page, title.slug);
  const { sources } = await fetchSources(context, title.tmdbId);
  const availability = await checkAvailability(context, title.tmdbId, true);
  const state = availability.json?.state;
  const expectedState = extra?.expectedState;

  await page.screenshot({ path: join(SHOTS, `${key}.png`) }).catch(() => undefined);

  const ok = shown && sources.length === 0 && (expectedState === undefined || state === expectedState);

  row.check = ok ? "pass" : "fail";
  row.notes.push(
    `Tela "INDISPONÍVEL PARA REPRODUÇÃO": ${shown}; fontes na API: ${sources.length}; estado de disponibilidade: ${state}${
      expectedState ? ` (esperado ${expectedState})` : ""
    }.`,
  );

  return row;
}

async function scenarioBlocked(page) {
  const row = await scenarioUnavailable(
    page,
    "private-blocked",
    "blocked",
    "Servidor em 127.0.0.1 SEM allowPrivateNetwork (SSRF)",
    { expectedState: "UNAVAILABLE" },
  );

  row.kind = "Proteção SSRF";

  for (const check of adapterChecks) {
    row.notes.push(`${check.pass ? "ok" : "FALHOU"}: ${check.name} — ${check.detail}`);

    if (!check.pass) {
      row.check = "fail";
    }
  }

  if (adapterChecks.length === 0) {
    row.check = "fail";
    row.notes.push("e2e-out/adapter-checks.json não existe (scripts/e2e-adapter-checks.ts não rodou).");
  }
}

/** Revokes the association in the middle of an HLS playback and checks the proxy gives up. */
async function scenarioRevoked(page) {
  const title = seed.titles.revoked;
  const row = addRow({
    key: "revoked-mid-session",
    scenario: "Associação REVOGADA no meio da sessão (HLS via proxy)",
    kind: "Revogação",
  });
  const proxyUrls = [];

  page.on("request", (request) => {
    if (request.url().includes("/api/playback/proxy/")) {
      proxyUrls.push(request.url());
    }
  });

  await page.goto(`/watch/${title.slug}`, { waitUntil: "domcontentloaded" });

  const probe = newRow({ key: "tmp", scenario: "tmp", kind: "tmp", job: JOB });
  const played = await proveChromePlayback(page, probe, "revoked-antes");

  row.notes.push(`Antes de revogar: ${played ? "tocando no Chrome" : "NÃO tocou"} (${probe.notes.join(" ")}).`);

  if (!played || proxyUrls.length === 0) {
    row.check = "fail";
    return;
  }

  const target = proxyUrls[proxyUrls.length - 1];

  await db.query('update "PlaybackAssociation" set "rightsStatus" = $1::"RightsStatus" where "id" = $2', [
    "REVOKED",
    title.associationId,
  ]);

  const requestStatus = () =>
    page.evaluate(async (url) => {
      const response = await fetch(url, { headers: { Range: "bytes=0-1023" } });

      return { status: response.status, body: (await response.text()).slice(0, 200) };
    }, target);

  const first = await requestStatus();

  await sleep(1500);

  const before = await mockStats();
  const again = [await requestStatus(), await requestStatus(), await requestStatus()];

  await sleep(500);

  const after = await mockStats();
  const noUpstreamBytes = before.hls === after.hls && before.xtreamMedia === after.xtreamMedia;
  const all410 = [first, ...again].every((result) => result.status === 410);
  const bodyClean = ![first, ...again].some((result) => containsSecret(result.body));

  row.notes.push(
    `Depois de revogar: proxy HTTP ${[first, ...again].map((result) => result.status).join("/")} (esperado 410); upstream recebeu ${after.hls - before.hls} requisição(ões) de HLS depois do 1º 410 (esperado 0); mensagem: "${first.body}".`,
  );

  // The player must surface the error as soon as it needs a new segment.
  await page.evaluate(() => {
    const video = document.querySelector("video");

    if (video && Number.isFinite(video.duration)) {
      video.currentTime = video.duration * 0.6;
      video.play().catch(() => undefined);
    }
  });

  let playerShowsError = false;

  try {
    await page.getByRole("button", { name: "Tentar de novo" }).first().waitFor({ state: "visible", timeout: 120_000 });
    playerShowsError = true;
    await page.screenshot({ path: join(SHOTS, "revoked-erro.png") }).catch(() => undefined);
  } catch {
    playerShowsError = false;
  }

  // The API itself offers no source for a revoked association.
  const { sources } = await fetchSources(context, title.tmdbId);

  row.notes.push(`O player mostrou o erro: ${playerShowsError}; fontes na API depois de revogar: ${sources.length}.`);
  row.check = all410 && noUpstreamBytes && bodyClean && playerShowsError && sources.length === 0 ? "pass" : "fail";
}

async function scenarioTmdb() {
  const row = addRow({
    key: "tmdb-real",
    scenario: "TMDB real (catálogo) -> identificação do título",
    kind: "TMDB",
    required: false,
  });

  if (!HAS_TMDB) {
    row.check = "skip";
    row.notes.push("pulado (sem TMDB_ACCESS_TOKEN).");
    return;
  }

  const response = await context.request.get("/api/tmdb/movie/10378");
  const body = await response.json().catch(() => null);
  const details = body?.details;
  const names = [details?.title, details?.originalTitle].filter((name) => typeof name === "string").join(" | ");
  const runtimeMinutes = Number(details?.durationInMinutes);
  const archive = seed.titles.archive;
  const { sources } = await fetchSources(context, archive.tmdbId);
  const ok =
    response.status() === 200 &&
    /big buck bunny/i.test(names) &&
    Number.isFinite(runtimeMinutes) &&
    sources[0]?.provider === "archive";

  row.check = ok ? "pass" : "fail";
  row.notes.push(
    `GET /api/tmdb/movie/10378 -> HTTP ${response.status()}, "${names}", ${runtimeMinutes} min; mesmo tmdbId resolve ${sources[0]?.provider ?? "nenhuma fonte"} no MatchFlix.`,
  );
}

async function scenarioReverify() {
  const row = addRow({
    key: "reverify-endpoint",
    scenario: "POST /api/internal/reverify (CRON_SECRET)",
    kind: "Disponibilidade periódica",
    required: false,
  });

  if (!CRON_SECRET) {
    row.check = "skip";
    row.notes.push("pulado: CRON_SECRET não definido no ambiente do teste.");
    return;
  }

  const anonymous = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const denied = await anonymous.post("/api/internal/reverify");
  const wrong = await anonymous.post("/api/internal/reverify", { headers: { Authorization: "Bearer errado" } });
  const allowed = await anonymous.post("/api/internal/reverify", {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
    timeout: 180_000,
  });
  const result = await allowed.json().catch(() => null);

  await anonymous.dispose();

  const ok = denied.status() === 401 && wrong.status() === 401 && allowed.status() === 200 && (result?.checked ?? 0) >= 1;

  row.check = ok ? "pass" : "fail";
  row.notes.push(
    `Sem token ${denied.status()}, token errado ${wrong.status()}, token certo ${allowed.status()} ${JSON.stringify(result)}.`,
  );
}

async function main() {
  await db.connect();
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
  context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 720 },
    locale: "pt-BR",
  });
  await context.tracing.start({ screenshots: true, snapshots: true });

  // No request of the browser may carry a mock credential or go to the mock itself.
  context.on("request", (request) => {
    const haystack = [request.url(), request.postData() ?? "", JSON.stringify(request.headers())].join("\n");

    if (containsSecret(haystack)) {
      leaks.push(`${request.method()} ${new URL(request.url()).pathname.slice(0, 80)} carrega credencial do servidor.`);
    }

    if (new URL(request.url()).origin === MOCK_ORIGIN) {
      leaks.push(`o navegador contatou o servidor do provedor diretamente: ${new URL(request.url()).pathname.slice(0, 40)}.`);
    }
  });

  // Nor may any response the browser receives (RSC payload, /api/playback JSON,
  // rewritten manifests, headers) carry one. Media bodies are not read.
  context.on("response", async (response) => {
    try {
      const headers = response.headers();
      const type = (headers["content-type"] ?? "").toLowerCase();
      const where = new URL(response.url()).pathname.slice(0, 80);

      if (containsSecret(JSON.stringify(headers))) {
        leaks.push(`cabeçalho de resposta de ${where} carrega credencial do servidor.`);
      }

      if (!/json|html|text|mpegurl|javascript/.test(type) || response.status() >= 300) {
        return;
      }

      if (containsSecret(await response.text())) {
        leaks.push(`a resposta de ${where} carrega credencial do servidor.`);
      }
    } catch {
      // Redirects, aborted or streamed bodies cannot be read: nothing to scan.
    }
  });

  const page = await context.newPage();

  page.on("console", (message) => {
    if (consoleLog.length < 300 && ["error", "warning"].includes(message.type())) {
      consoleLog.push(`[${message.type()}] ${message.text().slice(0, 300)}`);
    }
  });

  await login(page);
  log("Login pela interface: ok.");

  const scenarios = [
    ["tmdb", () => scenarioTmdb()],
    ["archive", () => scenarioArchive(page)],
    [
      "xtream",
      () =>
        scenarioProxied(page, {
          titleKey: "xtream",
          key: "xtream-mock",
          scenario: "Xtream mock via proxy (MP4 + Range)",
          kind: "Xtream+proxy MP4",
          source: "xtream-mock (vod:1)",
          proxyKind: "mp4",
        }),
    ],
    [
      "m3u",
      () =>
        scenarioProxied(page, {
          titleKey: "m3u",
          key: "m3u-mock",
          scenario: "M3U mock via proxy (HLS reescrito + hls.js)",
          kind: "M3U+proxy HLS",
          source: "m3u-mock (HLS)",
          proxyKind: "hls",
        }),
    ],
    ["peertube", () => scenarioPeerTube(page)],
    [
      "none",
      () =>
        scenarioUnavailable(page, "no-association", "none", "Título sem associação", {
          expectedState: "NONE",
        }),
    ],
    [
      "unverified",
      () =>
        scenarioUnavailable(page, "unverified-association", "unverified", "Associação UNVERIFIED (direitos não verificados)", {
          expectedState: "NONE",
        }),
    ],
    ["blocked", () => scenarioBlocked(page)],
    ["revoked", () => scenarioRevoked(page)],
    ["reverify", () => scenarioReverify()],
  ];

  for (const [name, run] of scenarios) {
    const before = rows.length;

    try {
      await run();
    } catch (error) {
      log(`Erro no cenário "${name}": ${errorText(error)}`);

      const row = rows[rows.length - 1];

      if (rows.length > before && row) {
        row.notes.push(`Erro inesperado no teste: ${errorText(error)}`);

        if (row.check !== undefined || row.key === "revoked-mid-session") {
          row.check = "fail";
        } else {
          for (const level of ["L1", "L2", "L3", "L4"]) {
            if (row.levels[level] === "na") {
              row.levels[level] = "fail";
              break;
            }
          }
        }
      } else {
        const failed = addRow({ key: `erro:${name}`, scenario: `Cenário ${name}`, kind: "Erro", required: true });

        failed.check = "fail";
        failed.notes.push(`Erro inesperado no teste: ${errorText(error)}`);
      }

      await page.screenshot({ path: join(SHOTS, `erro-${name}.png`) }).catch(() => undefined);
    }
  }

  // Credentials never reached the browser (any request, any scenario).
  const leakRow = addRow({
    key: "no-credential-leak",
    scenario: "Nenhuma requisição do navegador contém usuário/senha do servidor nem o servidor em si",
    kind: "Segurança de credenciais",
  });

  // The server's own log and the browser console must not hold them either.
  for (const [name, text] of [
    ["next-server.log", existsSync(join(OUT, "next-server.log")) ? readFileSync(join(OUT, "next-server.log"), "utf8") : ""],
    ["console do navegador", consoleLog.join("\n")],
  ]) {
    if (containsSecret(text)) {
      leaks.push(`${name} contém credencial do servidor.`);
    }
  }

  // The proxy must never forward the browser's cookies, and the mock must never
  // have been called with wrong credentials (that would mean they got lost).
  try {
    const stats = await mockStats();

    if (stats.cookieHeaders !== 0) {
      leaks.push(`o proxy repassou cookies do navegador ao provedor (${stats.cookieHeaders}).`);
    }

    if (stats.rejected !== 0) {
      leaks.push(`o provedor rejeitou ${stats.rejected} requisição(ões) por credencial incorreta.`);
    }
  } catch (error) {
    leaks.push(`não foi possível ler as estatísticas do provedor mock (${errorText(error)}).`);
  }

  leakRow.check = leaks.length === 0 ? "pass" : "fail";
  leakRow.notes.push(leaks.length === 0 ? "Nenhum vazamento observado." : leaks.slice(0, 5).join(" "));
}

let exitCode = 0;

try {
  await main();
} catch (error) {
  console.error("Erro fatal no e2e:", error);
  exitCode = 1;
}

try {
  await context?.tracing.stop({ path: join(OUT, "trace.zip") });
} catch {
  // Tracing is best effort.
}

await browser?.close().catch(() => undefined);
await db.end().catch(() => undefined);

writeFileSync(join(OUT, "console.log"), `${consoleLog.join("\n")}\n`);
writeFileSync(join(OUT, "e2e-report.json"), `${JSON.stringify(rows, null, 2)}\n`);

const markdown = renderMarkdown("E2E no Chrome — TMDB → Associação → Provedor → Player", rows);

writeFileSync(join(OUT, "e2e-report.md"), markdown);
console.log(`\n${markdown}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, { flag: "a" });
}

const failedRows = rows.filter((row) => {
  if (!row.required) {
    return false;
  }

  if (row.check === "fail") {
    return true;
  }

  return Object.values(row.levels).includes("fail") || Object.values(row.l5).includes("fail");
});

if (failedRows.length > 0) {
  console.error(`\nFALHA nos cenários: ${failedRows.map((row) => row.key).join(", ")}`);
  exitCode = 1;
}

process.exit(exitCode);
