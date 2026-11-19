// Final report of the playback-live workflow: merges the proof levels of the
// live-providers job (adapters + real network: L1, L2, L3, L5-a, L5-b) with the
// e2e-chrome job (the real Chrome: L1..L4, L5-c) into one scenario x level table.
//
//   node e2e/build-report.mjs <live-report.json> <e2e-report.json> [out.md]
//
// A missing input (job failed before writing it) is reported, not fatal.
// A scenario that only reached L3 is reported as L3, never as "plays".

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mergeRows, renderMarkdown } from "./report-lib.mjs";

const [liveFile, e2eFile, outFile = "final-report.md"] = process.argv.slice(2);

function load(file) {
  if (!file || !existsSync(file)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const live = load(liveFile);
const e2e = load(e2eFile);
const missing = [];

if (live === null) {
  missing.push("live-providers (live-report.json)");
}

if (e2e === null) {
  missing.push("e2e-chrome (e2e-report.json)");
}

const rows = mergeRows(live ?? [], e2e ?? []);
let markdown = renderMarkdown("Relatório final — prova de reprodução MatchFlix (L1 a L5)", rows);

if (missing.length > 0) {
  markdown += `\n> Relatório incompleto: sem dados de ${missing.join(" e ")}. O job correspondente falhou antes de gravá-lo.\n`;
}

markdown +=
  "\n> L5 só é marcado quando (a) ffprobe >= duração mínima, (b) decodificação completa sem erros e (c) o Chrome chegou ao evento `ended` com o progresso gravado como concluído. " +
  "Cenário que só chegou a L3 é L3 (disponibilidade e trecho decodificável), não prova que o filme inteiro reproduz.\n";

writeFileSync(outFile, markdown);
console.log(markdown);

if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, { flag: "a" });
}

for (const row of rows) {
  const failed =
    row.check === "fail" ||
    Object.values(row.levels).includes("fail") ||
    Object.values(row.l5).includes("fail");

  if (failed && row.required) {
    console.log(`::warning title=Cenário obrigatório com falha::${row.scenario}`);
  }
}
