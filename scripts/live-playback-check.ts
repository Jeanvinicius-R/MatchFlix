import { isAdapterFailure, type ResolvedAsset } from "../src/services/playback/adapters/adapter.types";
import { createArchiveAdapter } from "../src/services/playback/adapters/archive.adapter";
import { createPeerTubeAdapter } from "../src/services/playback/adapters/peertube.adapter";
import {
  decodeMedia,
  discoverPeerTubeVideo,
  ffprobeMedia,
  l5State,
  newRow,
  probeHls,
  probeVideoRange,
  writeReport,
  type ScenarioRow,
} from "./lib/live-lib";

/**
 * Real-network proof that the providers serve what MatchFlix thinks they serve.
 * Uses the REAL adapters (archive, peertube) with the real fetch and keeps
 * AVAILABILITY (the adapter answers and its license gate passes) apart from
 * PLAYBACK PROOF (the bytes are reachable and decodable):
 *
 *   L1 API respondendo, L2 Fonte acessível, L3 Trecho decodificável (10 s),
 *   L5-a duração >= mínimo, L5-b decodificação completa.
 *
 * L4 and L5-c need a browser: they are proven by the e2e-chrome job, which
 * writes the other half of the report (see e2e/build-report.mjs).
 *
 * Exit code 1 when a REQUIRED item (the four Internet Archive films) fails.
 *
 * Env: LIVE_FULL_DECODE=0 skips the whole-file decode (L5-b).
 *      LIVE_REPORT_DIR   where the json/markdown go (default: the OS temp dir).
 */

interface ArchiveTitle {
  id: string;
  title: string;
  /** Minimum plausible duration of the complete film (the real ones are longer). */
  minSeconds: number;
}

// Real durations from the archive.org metadata: BBB 596.5 s, Sintel 888.1 s,
// Tears of Steel 734.1 s, Elephants Dream 653.9 s.
const ARCHIVE_TITLES: readonly ArchiveTitle[] = [
  { id: "BigBuckBunny_124", title: "Big Buck Bunny", minSeconds: 500 },
  { id: "Sintel", title: "Sintel", minSeconds: 800 },
  { id: "Tears-of-Steel", title: "Tears of Steel", minSeconds: 700 },
  { id: "ElephantsDream", title: "Elephants Dream", minSeconds: 600 },
];

const FULL_DECODE_TIMEOUT_MS = 20 * 60 * 1000;
const PEERTUBE_MAX_FULL_DECODE_SECONDS = 900;

const fullDecode = process.env.LIVE_FULL_DECODE !== "0";

function log(message: string) {
  console.log(message);
}

/** Host + path only: never print a query string. */
function describeUrl(raw: string): string {
  try {
    const url = new URL(raw);

    return `${url.host}${url.pathname}`;
  } catch {
    return "(url inválida)";
  }
}

/**
 * L3 + L5-a/b for one playable URL. `minSeconds` is the duration the full title
 * must have; `allowFullDecode` is false for long videos we do not decode whole.
 */
async function proveDecoding(
  row: ScenarioRow,
  url: string,
  minSeconds: number,
  allowFullDecode: boolean,
): Promise<void> {
  const probe = await ffprobeMedia(url);

  if (!probe.ok) {
    row.levels.L3 = "fail";
    row.l5.a = "fail";
    row.notes.push(`ffprobe: ${probe.reason}`);
    return;
  }

  const { info } = probe;

  row.video = {
    title: row.video?.title ?? row.scenario,
    source: row.video?.source ?? row.kind,
    durationSeconds: info.durationSeconds,
  };

  // L5-a: the file really is as long as the title.
  if (info.durationSeconds >= minSeconds && info.hasVideo) {
    row.l5.a = "pass";
  } else {
    row.l5.a = "fail";
    row.notes.push(
      `duração ${info.durationSeconds.toFixed(1)} s < mínimo ${minSeconds} s ou sem vídeo.`,
    );
  }

  // L3: ten seconds of video decode without a single error.
  const sample = await decodeMedia(url, {
    limitSeconds: 10,
    minDecodedSeconds: 9,
    timeoutMs: 3 * 60 * 1000,
  });

  row.levels.L3 = sample.ok ? "pass" : "fail";

  if (!sample.ok) {
    row.notes.push(`L3: ${sample.reason ?? "falhou"}`);
  }

  // L5-b: decode EVERYTHING; the final decoded time must reach duration - 2 s.
  if (!allowFullDecode) {
    row.l5.b = "skip";
    row.notes.push("L5-b pulado: vídeo longo demais para a decodificação completa no CI.");
    return;
  }

  let full = await decodeMedia(url, {
    minDecodedSeconds: info.durationSeconds - 2,
    timeoutMs: FULL_DECODE_TIMEOUT_MS,
  });

  if (!full.ok) {
    // One retry: a dropped connection mid-download is not a broken file.
    log(`  decodificação completa falhou (${full.reason ?? "?"}); tentando de novo...`);
    full = await decodeMedia(url, {
      minDecodedSeconds: info.durationSeconds - 2,
      timeoutMs: FULL_DECODE_TIMEOUT_MS,
    });
  }

  row.l5.b = full.ok ? "pass" : "fail";
  row.notes.push(
    full.ok
      ? `L5-b: decodificou ${full.decodedSeconds.toFixed(1)} s de ${info.durationSeconds.toFixed(1)} s sem erros.`
      : `L5-b: ${full.reason ?? "falhou"}`,
  );
}

async function checkArchive(title: ArchiveTitle): Promise<ScenarioRow> {
  const row = newRow({
    key: `archive:${title.id}`,
    scenario: `Internet Archive — ${title.title} (${title.id})`,
    kind: "Archive direto (adapter real)",
    required: true,
    job: "live-providers",
  });

  row.video = { title: title.title, source: `archive.org/details/${title.id}` };
  log(`\n== ${row.scenario}`);

  const adapter = createArchiveAdapter();
  const resolved = await adapter.resolve(title.id, { signal: AbortSignal.timeout(30_000) });

  // DISPONIBILIDADE: the adapter answered and its license gate passed.
  if (isAdapterFailure(resolved)) {
    row.levels.L1 = "fail";
    row.notes.push(`DISPONIBILIDADE: falha — ${resolved.reason}`);
    log(`  DISPONIBILIDADE: falha — ${resolved.reason}`);
    return row;
  }

  const url = resolved.url;

  if (url === undefined) {
    row.levels.L1 = "fail";
    row.notes.push("DISPONIBILIDADE: o adaptador não devolveu uma URL pública.");
    return row;
  }

  row.levels.L1 = "pass";
  row.notes.push(
    `DISPONIBILIDADE: ok — licença aceita pelo gate: ${resolved.attribution?.license ?? "?"}; URL final ${describeUrl(url)}`,
  );
  log(`  DISPONIBILIDADE: ok — licença ${resolved.attribution?.license ?? "?"} — ${describeUrl(url)}`);

  // REPRODUÇÃO COMPROVADA, level by level.
  const range = await probeVideoRange(url);

  row.levels.L2 = range.ok ? "pass" : "fail";
  log(
    `  L2 Range: HTTP ${range.status}, ${range.contentType || "sem content-type"}, ftyp=${String(range.ftyp)}, ${range.bytes} bytes${range.reason ? ` — ${range.reason}` : ""}`,
  );

  if (!range.ok) {
    row.notes.push(`L2: ${range.reason ?? "falhou"}`);
    return row;
  }

  await proveDecoding(row, range.finalUrl, title.minSeconds, fullDecode);
  log(
    `  L3=${row.levels.L3} L5-a=${row.l5.a} L5-b=${row.l5.b} (L5-c só no Chrome, job e2e-chrome)`,
  );

  return row;
}

/** L2 for the asset the PeerTube adapter returned: HLS manifest + segment, or a ranged MP4. */
async function proveSourceReachable(
  asset: ResolvedAsset,
): Promise<{ ok: boolean; reason?: string; url: string }> {
  const url = asset.url;

  if (url === undefined) {
    return { ok: false, reason: "sem URL pública.", url: "" };
  }

  if (asset.type === "hls") {
    const hls = await probeHls(url);

    return { ok: hls.ok, reason: hls.reason, url };
  }

  const range = await probeVideoRange(url);

  return { ok: range.ok, reason: range.reason, url: range.finalUrl };
}

async function checkPeerTube(): Promise<ScenarioRow> {
  const row = newRow({
    key: "peertube",
    scenario: "PeerTube real (instância descoberta em runtime)",
    kind: "PeerTube direto (adapter real)",
    required: false,
    job: "live-providers",
  });

  log(`\n== ${row.scenario}`);

  const discovery = await discoverPeerTubeVideo({ minSeconds: 60, maxSeconds: 900 });

  if (!discovery.ok) {
    row.levels = { L1: "skip", L2: "skip", L3: "skip", L4: "skip" };
    row.l5 = { a: "skip", b: "skip", c: "skip" };
    row.notes.push(`pulado: ${discovery.reason}`);

    for (const attempt of discovery.tried.slice(0, 6)) {
      row.notes.push(attempt);
    }

    log(`  pulado: ${discovery.reason}`);
    return row;
  }

  const { pick } = discovery;

  row.video = {
    title: pick.title,
    source: `${pick.host} (${pick.asset.type})`,
    durationSeconds: pick.durationSeconds,
  };

  // Re-resolve with the real adapter and exactly the allowlist the server would use.
  const adapter = createPeerTubeAdapter({ allowedInstances: pick.allowedHosts });
  const resolved = await adapter.resolve(pick.assetId, { signal: AbortSignal.timeout(30_000) });

  if (isAdapterFailure(resolved) || resolved.url === undefined) {
    row.levels.L1 = "fail";
    row.notes.push(
      `DISPONIBILIDADE: falha — ${isAdapterFailure(resolved) ? resolved.reason : "sem URL pública"}`,
    );
    return row;
  }

  row.levels.L1 = "pass";
  row.notes.push(
    `DISPONIBILIDADE: ok — ${pick.assetId}, licença ${resolved.attribution?.license ?? "?"}, ${resolved.type}, hosts permitidos: ${pick.allowedHosts.join(", ")}`,
  );
  log(`  DISPONIBILIDADE: ok — ${pick.assetId} (${resolved.type})`);

  const reachable = await proveSourceReachable(resolved);

  row.levels.L2 = reachable.ok ? "pass" : "fail";
  log(`  L2: ${reachable.ok ? "ok" : (reachable.reason ?? "falhou")}`);

  if (!reachable.ok) {
    row.notes.push(`L2: ${reachable.reason ?? "falhou"}`);
    return row;
  }

  // The API's own duration is the "expected minimum" (minus a little tolerance).
  await proveDecoding(
    row,
    reachable.url,
    pick.durationSeconds * 0.95,
    fullDecode && pick.durationSeconds <= PEERTUBE_MAX_FULL_DECODE_SECONDS,
  );
  log(`  L3=${row.levels.L3} L5-a=${row.l5.a} L5-b=${row.l5.b}`);

  return row;
}

/** A required row passes only with L1, L2, L3 and the L5 parts a and b. */
function requiredRowFailed(row: ScenarioRow): boolean {
  if (!row.required) {
    return false;
  }

  const states = [row.levels.L1, row.levels.L2, row.levels.L3, row.l5.a];

  if (fullDecode) {
    states.push(row.l5.b);
  }

  return states.some((state) => state !== "pass");
}

async function main() {
  const rows: ScenarioRow[] = [];

  for (const title of ARCHIVE_TITLES) {
    rows.push(await checkArchive(title));
  }

  rows.push(await checkPeerTube());

  const reportDir = process.env.LIVE_REPORT_DIR ?? "/tmp";
  const markdown = writeReport({
    title: "Provedores reais — disponibilidade e prova de reprodução (job live-providers)",
    rows,
    jsonPath: `${reportDir}/live-report.json`,
    markdownPath: `${reportDir}/live-report.md`,
  });

  console.log(`\n${markdown}`);

  for (const row of rows) {
    log(
      `${row.key}: L1=${row.levels.L1} L2=${row.levels.L2} L3=${row.levels.L3} L5(a/b/c)=${row.l5.a}/${row.l5.b}/${row.l5.c} -> L5 parcial ${l5State(row.l5)}`,
    );
  }

  const failed = rows.filter(requiredRowFailed);

  if (failed.length > 0) {
    console.error(
      `\nFALHA: itens obrigatórios sem prova de reprodução: ${failed.map((row) => row.key).join(", ")}`,
    );
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error("Erro inesperado no live-playback-check:", error);
  process.exit(1);
});
