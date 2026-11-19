import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  ADAPTER_USER_AGENT,
  fetchJson,
  fetchText,
  isAdapterFailure,
  isRecord,
  type ResolvedAsset,
} from "../../src/services/playback/adapters/adapter.types";
import { createPeerTubeAdapter } from "../../src/services/playback/adapters/peertube.adapter";

/**
 * Helpers shared by scripts/live-playback-check.ts and scripts/e2e-seed.ts:
 * running ffprobe/ffmpeg, probing a media URL, discovering a real PeerTube video
 * and rendering the proof-level report (L1..L5, see renderMarkdown).
 *
 * Proof levels (never mixed up):
 *   L1 "API respondendo"              adapter/API answers valid JSON, license gate passes
 *   L2 "Fonte acessível"              Range 206/200 + video content-type + ftyp box,
 *                                     or m3u8 manifest + 1st segment download
 *   L3 "Trecho decodificável"         ffmpeg decodes 10 s (does NOT prove the whole film)
 *   L4 "Reprodução funcional no Chrome"
 *   L5 "Reprodução integral comprovada" = (a) ffprobe duration >= expected minimum,
 *                                     (b) full ffmpeg decode, no error, final time >= duration - 2 s,
 *                                     (c) Chrome plays to the "ended" event and the
 *                                     progress is saved as completed.
 */

export type LevelState = "pass" | "fail" | "skip" | "na";

export type LevelId = "L1" | "L2" | "L3" | "L4";

export interface ScenarioRow {
  /** Stable id used to merge the reports of the two jobs. */
  key: string;
  scenario: string;
  /** "Archive direto", "Xtream+proxy MP4", ... */
  kind: string;
  /** A failure of a required row fails the job. */
  required: boolean;
  job: "live-providers" | "e2e-chrome";
  /** "na" = not tested by this job / not applicable. */
  levels: Record<LevelId, LevelState>;
  l5: { a: LevelState; b: LevelState; c: LevelState };
  /** Non-playback checks (revocation, SSRF, no association...): one pass/fail result. */
  check?: LevelState;
  notes: string[];
  video?: {
    title: string;
    source: string;
    durationSeconds?: number;
    playedSeconds?: number;
  };
}

export function newRow(
  base: Pick<ScenarioRow, "key" | "scenario" | "kind" | "required" | "job">,
): ScenarioRow {
  return {
    ...base,
    levels: { L1: "na", L2: "na", L3: "na", L4: "na" },
    l5: { a: "na", b: "na", c: "na" },
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

const MAX_STDERR_CHARS = 4000;

/** Runs a command to the end (or the timeout). Never rejects. */
export function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs: number; onStdoutLine?: (line: string) => void },
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let carry = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    function finish(result: CommandResult) {
      if (settled) {
        return;
      }

      settled = true;

      // `timer` is initialised below, before any event can fire `finish`.
      clearTimeout(timer);
      resolve(result);
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");

      if (!options.onStdoutLine) {
        stdout = (stdout + text).slice(-MAX_STDERR_CHARS * 8);
        return;
      }

      const lines = (carry + text).split("\n");

      carry = lines.pop() ?? "";

      for (const line of lines) {
        options.onStdoutLine(line.trim());
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-MAX_STDERR_CHARS);
    });

    child.on("error", (error) => {
      finish({ code: null, stdout, stderr, timedOut, spawnError: error.message });
    });

    child.on("close", (code) => {
      if (options.onStdoutLine && carry.trim() !== "") {
        options.onStdoutLine(carry.trim());
      }

      finish({ code, stdout, stderr, timedOut });
    });
  });
}

export interface ProbeInfo {
  durationSeconds: number;
  hasVideo: boolean;
  width?: number;
  height?: number;
  codec?: string;
}

/** ffprobe of a URL: container duration and the first video stream. */
export async function ffprobeMedia(
  url: string,
): Promise<{ ok: true; info: ProbeInfo } | { ok: false; reason: string }> {
  const result = await runCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-user_agent",
      ADAPTER_USER_AGENT,
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      url,
    ],
    { timeoutMs: 90_000 },
  );

  if (result.spawnError) {
    return { ok: false, reason: `ffprobe indisponível (${result.spawnError}).` };
  }

  if (result.timedOut) {
    return { ok: false, reason: "ffprobe excedeu o tempo limite." };
  }

  if (result.code !== 0) {
    return { ok: false, reason: `ffprobe falhou: ${result.stderr.trim().slice(0, 300)}` };
  }

  let data: unknown;

  try {
    data = JSON.parse(result.stdout);
  } catch {
    return { ok: false, reason: "ffprobe devolveu uma saída inválida." };
  }

  const format: Record<string, unknown> =
    isRecord(data) && isRecord(data.format) ? data.format : {};
  const duration = Number(format.duration);
  const streams = isRecord(data) && Array.isArray(data.streams) ? (data.streams as unknown[]) : [];
  const video = streams.find(
    (stream): stream is Record<string, unknown> =>
      isRecord(stream) && stream.codec_type === "video",
  );

  if (!Number.isFinite(duration) || duration <= 0) {
    return { ok: false, reason: "ffprobe não informou a duração do vídeo." };
  }

  const info: ProbeInfo = { durationSeconds: duration, hasVideo: video !== undefined };

  if (video) {
    if (typeof video.width === "number") {
      info.width = video.width;
    }

    if (typeof video.height === "number") {
      info.height = video.height;
    }

    if (typeof video.codec_name === "string") {
      info.codec = video.codec_name;
    }
  }

  return { ok: true, info };
}

export interface DecodeResult {
  ok: boolean;
  decodedSeconds: number;
  reason?: string;
  /** How the media was read when that differs from the plain URL (shown in the report). */
  note?: string;
}

/**
 * ffmpeg's HLS demuxer reads only the FIRST segment of a playlist made of one
 * fragmented MP4 with #EXT-X-MAP + #EXT-X-BYTERANGE (PeerTube's format) and
 * still exits successfully, so a "full decode" would stop after ~6 s. Every
 * segment of such a playlist is a contiguous byte range of ONE file, hence that
 * file is the whole video: decode it directly. Null when the playlist has
 * another shape (the plain URL is then used).
 */
export async function singleFmp4OfHls(url: string): Promise<string | null> {
  if (!/\.m3u8(?:[?#]|$)/i.test(url)) {
    return null;
  }

  const master = await getText(url);

  if (!master.ok) {
    return null;
  }

  let mediaUrl = url;
  let media = master.text;

  if (master.text.includes("#EXT-X-STREAM-INF")) {
    // The variant with the lowest bandwidth: the same video, the smallest download.
    const lines = master.text.split(/\r?\n/);
    let best: { bandwidth: number; uri: string } | null = null;

    for (let index = 0; index < lines.length - 1; index += 1) {
      const match = /^#EXT-X-STREAM-INF:.*?\bBANDWIDTH=(\d+)/.exec(lines[index]);
      const uri = lines[index + 1]?.trim();

      if (match && uri && !uri.startsWith("#")) {
        const bandwidth = Number(match[1]);

        if (best === null || bandwidth < best.bandwidth) {
          best = { bandwidth, uri };
        }
      }
    }

    if (!best) {
      return null;
    }

    try {
      mediaUrl = new URL(best.uri, url).toString();
    } catch {
      return null;
    }

    const variant = await getText(mediaUrl);

    if (!variant.ok) {
      return null;
    }

    media = variant.text;
  }

  if (!media.includes("#EXT-X-MAP") || !media.includes("#EXT-X-BYTERANGE")) {
    return null;
  }

  const files = new Set<string>();

  for (const line of media.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed !== "" && !trimmed.startsWith("#")) {
      files.add(trimmed);
    }
  }

  const mapUri = /#EXT-X-MAP:.*?URI="([^"]+)"/.exec(media)?.[1];

  if (files.size !== 1 || !mapUri || !files.has(mapUri)) {
    return null;
  }

  try {
    return new URL(mapUri, mediaUrl).toString();
  } catch {
    return null;
  }
}

/** "00:09:56.480000" -> seconds, else null. */
function parseOutTime(line: string): number | null {
  const match = /^out_time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(line);

  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

/**
 * Decodes the media with ffmpeg into the null muxer. With `limitSeconds` only
 * that much is read (L3); without it the WHOLE file is decoded (L5-b). Any text
 * ffmpeg prints at "-v error" level counts as a decoding error.
 */
export async function decodeMedia(
  url: string,
  options: {
    limitSeconds?: number;
    minDecodedSeconds: number;
    timeoutMs: number;
    /** Raw "-headers" value ("Cookie: a=b\r\n"), e.g. for the authenticated proxy. */
    headers?: string;
  },
): Promise<DecodeResult> {
  const args = [
    "-v",
    "error",
    "-nostdin",
    "-nostats",
    "-progress",
    "pipe:1",
    "-user_agent",
    ADAPTER_USER_AGENT,
  ];

  if (options.headers) {
    args.push("-headers", options.headers);
  }

  if (options.limitSeconds !== undefined) {
    args.push("-t", String(options.limitSeconds));
  }

  // Public HLS only (the authenticated proxy URL has no ".m3u8" to recognise).
  const flattened = options.headers ? null : await singleFmp4OfHls(url);
  const note = flattened
    ? "decodificado a partir do arquivo fMP4 único da variante HLS (o demuxer HLS do ffmpeg só lê o 1º segmento deste formato; os segmentos são faixas contíguas desse arquivo)"
    : undefined;

  args.push("-i", flattened ?? url, "-f", "null", "-");

  let decodedSeconds = 0;
  const result = await runCommand("ffmpeg", args, {
    timeoutMs: options.timeoutMs,
    onStdoutLine(line) {
      const seconds = parseOutTime(line);

      if (seconds !== null && seconds > decodedSeconds) {
        decodedSeconds = seconds;
      }
    },
  });

  if (result.spawnError) {
    return { ok: false, decodedSeconds, note, reason: `ffmpeg indisponível (${result.spawnError}).` };
  }

  if (result.timedOut) {
    return { ok: false, decodedSeconds, note, reason: "ffmpeg excedeu o tempo limite." };
  }

  if (result.code !== 0) {
    return {
      ok: false,
      decodedSeconds,
      note,
      reason: `ffmpeg falhou (código ${String(result.code)}): ${result.stderr.trim().slice(0, 300)}`,
    };
  }

  if (result.stderr.trim() !== "") {
    return {
      ok: false,
      decodedSeconds,
      note,
      reason: `ffmpeg registrou erros de decodificação: ${result.stderr.trim().slice(0, 300)}`,
    };
  }

  if (decodedSeconds < options.minDecodedSeconds) {
    return {
      ok: false,
      decodedSeconds,
      note,
      reason: `decodificou só ${decodedSeconds.toFixed(1)} s (mínimo ${options.minDecodedSeconds.toFixed(1)} s).`,
    };
  }

  return { ok: true, decodedSeconds, note };
}

// ---------------------------------------------------------------------------
// HTTP probes
// ---------------------------------------------------------------------------

const HEAD_BYTES = 1024 * 1024;

async function readHead(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
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

/** MP4/ISO-BMFF: a box name ("ftyp", "styp", "moof"...) sits at bytes 4..8. */
export function hasIsoBox(head: Buffer, names: readonly string[]): boolean {
  return head.length >= 12 && names.includes(head.subarray(4, 8).toString("latin1"));
}

export interface RangeProbe {
  ok: boolean;
  status: number;
  contentType: string;
  ftyp: boolean;
  bytes: number;
  finalUrl: string;
  reason?: string;
}

/** L2 for a progressive file: Range request, 206/200, video content-type, "ftyp" box. */
export async function probeVideoRange(
  url: string,
  headers: Record<string, string> = {},
): Promise<RangeProbe> {
  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        Range: `bytes=0-${HEAD_BYTES - 1}`,
        "User-Agent": ADAPTER_USER_AGENT,
        ...headers,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      ftyp: false,
      bytes: 0,
      finalUrl: url,
      reason: `falha de rede (${error instanceof Error ? error.name : "erro"}).`,
    };
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  let head: Buffer;

  try {
    head = await readHead(response, HEAD_BYTES);
  } catch {
    head = Buffer.alloc(0);
  }

  const probe: RangeProbe = {
    ok: false,
    status: response.status,
    contentType,
    ftyp: hasIsoBox(head, ["ftyp"]),
    bytes: head.length,
    finalUrl: response.url || url,
  };

  if (response.status !== 206 && response.status !== 200) {
    probe.reason = `HTTP ${response.status} (esperado 206/200).`;
  } else if (!contentType.startsWith("video/")) {
    probe.reason = `content-type "${contentType}" não é de vídeo.`;
  } else if (!probe.ftyp) {
    probe.reason = 'a caixa "ftyp" não aparece nos primeiros bytes.';
  } else {
    probe.ok = true;
  }

  return probe;
}

export interface HlsProbe {
  ok: boolean;
  reason?: string;
  segmentUrl?: string;
}

async function getText(url: string): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const result = await fetchText(fetch, url, {
    signal: AbortSignal.timeout(30_000),
    what: "o manifesto HLS",
    accept: "application/vnd.apple.mpegurl, */*",
    maxBytes: 2 * 1024 * 1024,
    allowedHost: () => true,
  });

  return result.ok ? { ok: true, text: result.data } : { ok: false, reason: result.reason };
}

/** First URI line of a playlist (a variant or a segment), resolved against `base`. */
function firstUriLine(playlist: string, base: string): string | null {
  for (const line of playlist.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed !== "" && !trimmed.startsWith("#")) {
      try {
        return new URL(trimmed, base).toString();
      } catch {
        return null;
      }
    }
  }

  return null;
}

/** L2 for HLS: master (or media) playlist, then the first segment really downloads. */
export async function probeHls(masterUrl: string): Promise<HlsProbe> {
  const master = await getText(masterUrl);

  if (!master.ok) {
    return { ok: false, reason: master.reason };
  }

  if (!master.text.trimStart().startsWith("#EXTM3U")) {
    return { ok: false, reason: "o manifesto não começa com #EXTM3U." };
  }

  let mediaPlaylistUrl = masterUrl;
  let mediaPlaylist = master.text;

  if (master.text.includes("#EXT-X-STREAM-INF")) {
    const variantUrl = firstUriLine(master.text, masterUrl);

    if (!variantUrl) {
      return { ok: false, reason: "o manifesto master não lista variantes." };
    }

    const variant = await getText(variantUrl);

    if (!variant.ok) {
      return { ok: false, reason: variant.reason };
    }

    mediaPlaylistUrl = variantUrl;
    mediaPlaylist = variant.text;
  }

  const segmentUrl = firstUriLine(mediaPlaylist, mediaPlaylistUrl);

  if (!segmentUrl) {
    return { ok: false, reason: "a playlist de mídia não tem segmentos." };
  }

  let response: Response;

  try {
    response = await fetch(segmentUrl, {
      headers: { Range: `bytes=0-${HEAD_BYTES - 1}`, "User-Agent": ADAPTER_USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    return { ok: false, reason: "falha de rede ao baixar o primeiro segmento.", segmentUrl };
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const head = await readHead(response, HEAD_BYTES).catch(() => Buffer.alloc(0));

  if (response.status !== 200 && response.status !== 206) {
    return { ok: false, reason: `o primeiro segmento respondeu HTTP ${response.status}.`, segmentUrl };
  }

  if (contentType.startsWith("text/")) {
    return { ok: false, reason: `o primeiro segmento veio como "${contentType}".`, segmentUrl };
  }

  const isTransportStream = head.length > 0 && head[0] === 0x47;
  const isIsoSegment = hasIsoBox(head, ["ftyp", "styp", "moof", "moov"]);

  if (!isTransportStream && !isIsoSegment) {
    return { ok: false, reason: "o primeiro segmento não parece vídeo (TS/fMP4).", segmentUrl };
  }

  return { ok: true, segmentUrl };
}

// ---------------------------------------------------------------------------
// PeerTube: pick a real, openly licensed video at run time
// ---------------------------------------------------------------------------

/** Public instances tried in order; the first that serves a gate-passing video wins. */
export const PEERTUBE_CANDIDATE_INSTANCES: readonly string[] = [
  "framatube.org",
  "video.blender.org",
  "tilvids.com",
  "peertube.debian.social",
];

export interface PeerTubePick {
  host: string;
  uuid: string;
  assetId: string;
  title: string;
  durationSeconds: number;
  /** Instance + media hosts: exactly what PEERTUBE_ALLOWED_INSTANCES must list. */
  allowedHosts: string[];
  asset: ResolvedAsset;
}

export type PeerTubeDiscovery =
  | { ok: true; pick: PeerTubePick; tried: string[] }
  | { ok: false; reason: string; tried: string[] };

/** Hosts that serve the media of a PeerTube video detail (HLS playlists and MP4 files). */
function mediaHostsOf(detail: Record<string, unknown>): string[] {
  const hosts = new Set<string>();

  function add(raw: unknown) {
    if (typeof raw !== "string") {
      return;
    }

    try {
      hosts.add(new URL(raw).host.toLowerCase());
    } catch {
      // Not a URL: ignore.
    }
  }

  for (const list of [detail.streamingPlaylists, detail.files]) {
    if (!Array.isArray(list)) {
      continue;
    }

    for (const entry of list as unknown[]) {
      if (isRecord(entry)) {
        add(entry.playlistUrl);
        add(entry.fileUrl);
      }
    }
  }

  return [...hosts];
}

export async function discoverPeerTubeVideo(
  options: {
    instances?: readonly string[];
    minSeconds?: number;
    maxSeconds?: number;
  } = {},
): Promise<PeerTubeDiscovery> {
  const instances = options.instances ?? PEERTUBE_CANDIDATE_INSTANCES;
  const minSeconds = options.minSeconds ?? 60;
  const maxSeconds = options.maxSeconds ?? 900;
  const tried: string[] = [];

  for (const host of instances) {
    const params = new URLSearchParams();

    for (const licence of ["1", "2", "7"]) {
      params.append("licenceOneOf", licence);
    }

    params.set("hasHLSFiles", "true");
    params.set("isLive", "false");
    params.set("isLocal", "true");
    params.set("nsfw", "false");
    params.set("durationMin", String(minSeconds));
    params.set("durationMax", String(maxSeconds));
    params.set("sort", "-views");
    params.set("count", "12");

    const list = await fetchJson<unknown>(
      fetch,
      `https://${host}/api/v1/videos?${params.toString()}`,
      {
        signal: AbortSignal.timeout(25_000),
        what: `a lista do PeerTube (${host})`,
        allowedHost: (target) => target === host,
      },
    );

    if (!list.ok) {
      tried.push(`${host}: ${list.reason}`);
      continue;
    }

    const items =
      isRecord(list.data) && Array.isArray(list.data.data) ? (list.data.data as unknown[]) : [];

    for (const item of items) {
      const uuid = isRecord(item) && typeof item.uuid === "string" ? item.uuid : null;

      if (uuid === null) {
        continue;
      }

      const detailResult = await fetchJson<unknown>(
        fetch,
        `https://${host}/api/v1/videos/${encodeURIComponent(uuid)}`,
        {
          signal: AbortSignal.timeout(25_000),
          what: `o PeerTube (${host})`,
          allowedHost: (target) => target === host,
        },
      );
      const detail =
        detailResult.ok && isRecord(detailResult.data) ? detailResult.data : null;

      if (detail === null) {
        tried.push(`${host}/${uuid}: detalhe indisponível.`);
        continue;
      }

      const duration = Number(detail.duration);
      const title = typeof detail.name === "string" ? detail.name : uuid;

      if (!Number.isFinite(duration) || duration < minSeconds || duration > maxSeconds) {
        continue;
      }

      const allowedHosts = [...new Set([host, ...mediaHostsOf(detail)])];
      const adapter = createPeerTubeAdapter({ allowedInstances: allowedHosts });
      const assetId = `${host}/${uuid}`;
      const resolved = await adapter.resolve(assetId, { signal: AbortSignal.timeout(25_000) });

      if (isAdapterFailure(resolved)) {
        tried.push(`${assetId}: ${resolved.reason}`);
        continue;
      }

      return {
        ok: true,
        tried,
        pick: {
          host,
          uuid,
          assetId,
          title,
          durationSeconds: duration,
          allowedHosts,
          asset: resolved,
        },
      };
    }
  }

  return {
    ok: false,
    reason: "nenhuma instância testada serviu um vídeo CC/PD que passe pelo gate do adaptador.",
    tried,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const SYMBOL: Record<LevelState, string> = {
  pass: "✅",
  fail: "❌",
  skip: "pulado",
  na: "—",
};

/** L5 is proven only when (a), (b) and (c) all pass. */
export function l5State(l5: ScenarioRow["l5"]): LevelState {
  const parts = [l5.a, l5.b, l5.c];

  if (parts.every((part) => part === "pass")) {
    return "pass";
  }

  if (parts.some((part) => part === "fail")) {
    return "fail";
  }

  return parts.some((part) => part === "pass") ? "skip" : "na";
}

function l5Cell(l5: ScenarioRow["l5"]): string {
  const state = l5State(l5);

  if (state === "pass" || state === "fail") {
    return SYMBOL[state];
  }

  const detail = `a ${SYMBOL[l5.a]} · b ${SYMBOL[l5.b]} · c ${SYMBOL[l5.c]}`;

  return state === "skip" ? `parcial (${detail})` : "—";
}

/** The highest level whose proofs (and all below it) passed. */
export function maxProvenLevel(row: ScenarioRow): string {
  const order: [string, LevelState][] = [
    ["L1", row.levels.L1],
    ["L2", row.levels.L2],
    ["L3", row.levels.L3],
    ["L4", row.levels.L4],
    ["L5", l5State(row.l5)],
  ];
  let reached = "nenhum";

  for (const [name, state] of order) {
    if (state !== "pass") {
      break;
    }

    reached = name;
  }

  return reached;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderMarkdown(title: string, rows: readonly ScenarioRow[]): string {
  const lines = [
    `## ${title}`,
    "",
    "Níveis: **L1** API respondendo · **L2** Fonte acessível · **L3** Trecho decodificável (10 s) · " +
      "**L4** Reprodução no Chrome · **L5** Reprodução integral (a duração, b decodificação completa, c Chrome até o fim).",
    "",
    "| Cenário | Tipo | L1 | L2 | L3 | L4 | L5 | Nível máximo | Observações |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const row of rows) {
    const cells = row.check
      ? ["—", "—", "—", "—", SYMBOL[row.check] + " (verificação)", row.check === "pass" ? "ok" : "—"]
      : [
          SYMBOL[row.levels.L1],
          SYMBOL[row.levels.L2],
          SYMBOL[row.levels.L3],
          SYMBOL[row.levels.L4],
          l5Cell(row.l5),
          maxProvenLevel(row),
        ];

    lines.push(
      `| ${escapeCell(row.scenario)} | ${escapeCell(row.kind)} | ${cells.join(" | ")} | ${escapeCell(row.notes.join(" ").slice(0, 400))} |`,
    );
  }

  const videos = rows.filter((row) => row.video);

  if (videos.length > 0) {
    lines.push(
      "",
      "### Vídeos verificados no provedor (a reprodução no Chrome é comprovada no job e2e-chrome)",
      "",
      "| Título | Fonte | Duração |",
      "| --- | --- | --- |",
    );

    for (const row of videos) {
      const video = row.video;

      if (!video) {
        continue;
      }

      lines.push(
        `| ${escapeCell(video.title)} | ${escapeCell(video.source)} | ${
          video.durationSeconds !== undefined ? `${video.durationSeconds.toFixed(1)} s` : "—"
        } |`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

/** Writes JSON + markdown files and appends the markdown to the Actions step summary. */
export function writeReport(options: {
  title: string;
  rows: readonly ScenarioRow[];
  jsonPath: string;
  markdownPath: string;
}): string {
  const markdown = renderMarkdown(options.title, options.rows);

  for (const path of [options.jsonPath, options.markdownPath]) {
    mkdirSync(dirname(path), { recursive: true });
  }

  writeFileSync(options.jsonPath, `${JSON.stringify(options.rows, null, 2)}\n`);
  writeFileSync(options.markdownPath, markdown);

  const summary = process.env.GITHUB_STEP_SUMMARY;

  if (summary) {
    appendFileSync(summary, `${markdown}\n`);
  }

  return markdown;
}
