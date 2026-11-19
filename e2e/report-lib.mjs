// Report helpers shared by e2e/playback.e2e.mjs and e2e/build-report.mjs.
// Same row format as scripts/lib/live-lib.ts (ScenarioRow), so the reports of
// the live-providers and e2e-chrome jobs can be merged by `key`.
//
// Proof levels, never mixed up:
//   L1 API respondendo · L2 Fonte acessível · L3 Trecho decodificável (10 s)
//   L4 Reprodução funcional no Chrome
//   L5 Reprodução integral = (a) ffprobe >= duração mínima, (b) decodificação
//      completa sem erros, (c) Chrome até o evento "ended" + progresso concluído.

export const SYMBOL = { pass: "✅", fail: "❌", skip: "pulado", na: "—" };

export function newRow({ key, scenario, kind, required = true, job }) {
  return {
    key,
    scenario,
    kind,
    required,
    job,
    levels: { L1: "na", L2: "na", L3: "na", L4: "na" },
    l5: { a: "na", b: "na", c: "na" },
    notes: [],
  };
}

export function l5State(l5) {
  const parts = [l5.a, l5.b, l5.c];

  if (parts.every((part) => part === "pass")) {
    return "pass";
  }

  if (parts.some((part) => part === "fail")) {
    return "fail";
  }

  return parts.some((part) => part === "pass") ? "skip" : "na";
}

function l5Cell(l5) {
  const state = l5State(l5);

  if (state === "pass" || state === "fail") {
    return SYMBOL[state];
  }

  return state === "skip"
    ? `parcial (a ${SYMBOL[l5.a]} · b ${SYMBOL[l5.b]} · c ${SYMBOL[l5.c]})`
    : "—";
}

/** The highest level whose proof (and every level below it) passed. */
export function maxProvenLevel(row) {
  const order = [
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

function escapeCell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderMarkdown(title, rows) {
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
      ? ["—", "—", "—", "—", `${SYMBOL[row.check]} (verificação)`, row.check === "pass" ? "ok" : "—"]
      : [
          SYMBOL[row.levels.L1],
          SYMBOL[row.levels.L2],
          SYMBOL[row.levels.L3],
          SYMBOL[row.levels.L4],
          l5Cell(row.l5),
          maxProvenLevel(row),
        ];

    lines.push(
      `| ${escapeCell(row.scenario)} | ${escapeCell(row.kind)} | ${cells.join(" | ")} | ${escapeCell(
        row.notes.join(" ").slice(0, 500),
      )} |`,
    );
  }

  const videos = rows.filter((row) => row.video);
  // Only a Chrome playback proof (L4) counts as "played"; the rest was just checked.
  const played = videos.filter((row) => row.levels.L4 === "pass");
  const checkedOnly = videos.filter((row) => row.levels.L4 !== "pass");
  const seconds = (value) => (typeof value === "number" ? `${value.toFixed(1)} s` : "—");

  if (played.length > 0) {
    lines.push(
      "",
      "### Vídeos efetivamente reproduzidos no Chrome (L4 ✅)",
      "",
      "| Título | Fonte | Duração | Tempo reproduzido no Chrome |",
      "| --- | --- | --- | --- |",
    );

    for (const { video } of played) {
      lines.push(
        `| ${escapeCell(video.title)} | ${escapeCell(video.source)} | ${seconds(video.durationSeconds)} | ${seconds(video.playedSeconds)} |`,
      );
    }
  }

  if (checkedOnly.length > 0) {
    lines.push(
      "",
      "### Vídeos verificados, sem reprodução comprovada no Chrome",
      "",
      "| Título | Fonte | Duração |",
      "| --- | --- | --- |",
    );

    for (const { video } of checkedOnly) {
      lines.push(
        `| ${escapeCell(video.title)} | ${escapeCell(video.source)} | ${seconds(video.durationSeconds)} |`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function mergeState(states) {
  const known = states.filter((state) => state !== undefined && state !== "na");

  if (known.includes("fail")) {
    return "fail";
  }

  if (known.includes("pass")) {
    return "pass";
  }

  return known.includes("skip") ? "skip" : "na";
}

/** Merges the rows of several jobs by `key` (a failure beats a pass, a pass beats "na"). */
export function mergeRows(...lists) {
  const byKey = new Map();

  for (const rows of lists) {
    for (const row of rows) {
      const group = byKey.get(row.key) ?? [];

      group.push(row);
      byKey.set(row.key, group);
    }
  }

  const merged = [];

  for (const group of byKey.values()) {
    const first = group[0];
    const row = newRow({
      key: first.key,
      scenario: first.scenario,
      kind: first.kind,
      required: group.some((item) => item.required),
      job: "merged",
    });

    for (const level of ["L1", "L2", "L3", "L4"]) {
      row.levels[level] = mergeState(group.map((item) => item.levels?.[level]));
    }

    for (const part of ["a", "b", "c"]) {
      row.l5[part] = mergeState(group.map((item) => item.l5?.[part]));
    }

    const checks = group.map((item) => item.check).filter((check) => check !== undefined);

    if (checks.length > 0) {
      row.check = mergeState(checks);
    }

    for (const item of group) {
      for (const note of item.notes ?? []) {
        row.notes.push(`[${item.job}] ${note}`);
      }
    }

    for (const item of group) {
      if (!item.video) {
        continue;
      }

      row.video = {
        title: row.video?.title ?? item.video.title,
        source: row.video?.source ?? item.video.source,
        durationSeconds: row.video?.durationSeconds ?? item.video.durationSeconds,
        playedSeconds: row.video?.playedSeconds ?? item.video.playedSeconds,
      };
    }

    merged.push(row);
  }

  return merged;
}
