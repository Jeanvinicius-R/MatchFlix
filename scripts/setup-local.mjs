#!/usr/bin/env node
// Prepara um clone novo do MatchFlix para rodar com Docker Compose (LAN).
// Roda antes de `docker compose up` em `npm run docker:up` e é seguro repetir:
//
// - Sem .env: copia .env.example -> .env e gera um AUTH_SECRET forte.
// - Com .env: NUNCA sobrescreve. Só preenche AUTH_SECRET/DATABASE_URL se
//   estiverem vazios e acrescenta variáveis novas do exemplo que faltarem
//   (com o valor do exemplo, que não é segredo). Valores existentes ficam.
// - Nunca imprime valores — só se cada variável está configurada ou vazia.
// - Confere se o .env está ignorado pelo Git e se o Docker está disponível.
//
// Só módulos nativos do Node. Uso: node scripts/setup-local.mjs [--skip-docker-check]
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");
const EXAMPLE_PATH = path.join(ROOT, ".env.example");

/** Igual ao serviço "postgres" do docker-compose.yml, visto do Windows (porta no loopback). */
const COMPOSE_DATABASE_URL =
  "postgresql://aurel:aurel@localhost:5432/aurel?schema=public";

/** Nunca têm o valor exibido, nem parcialmente. */
const SECRET_KEYS = new Set([
  "AUTH_SECRET",
  "DATABASE_URL",
  "TMDB_ACCESS_TOKEN",
  "YOUTUBE_API_KEY",
]);

/** Opcionais: vazias são normais e não aparecem como pendência. */
const OPTIONAL_KEYS = new Set([
  "DATABASE_DRIVER",
  "MEDIA_LIBRARY_DIR",
  "MEDIA_UPLOAD_DIR",
  "MEDIA_UPLOAD_MAX_VIDEO_MB",
  "PLAYBACK_AUTHORIZED_BASE_URL",
  "YOUTUBE_API_KEY",
  "YOUTUBE_ALLOWED_CHANNEL_IDS",
]);

const LINE_PATTERN = /^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$/;

function unquote(raw) {
  const value = raw.trim();
  return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

/** Mantém o arquivo como texto (comentários, ordem e quebras de linha preservados). */
function parseEnv(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = LINE_PATTERN.exec(line);
    if (match && !values.has(match[1])) {
      values.set(match[1], unquote(match[2]));
    }
  }
  return values;
}

/** Troca o valor de uma linha existente; se não houver a linha, acrescenta no fim. */
function setValue(text, key, value, eol) {
  const pattern = new RegExp(`^(\\s*${key}\\s*=).*$`, "m");
  if (pattern.test(text)) {
    return text.replace(pattern, (_, prefix) => `${prefix}"${value}"`);
  }
  const separator = text.endsWith("\n") || text === "" ? "" : eol;
  return `${text}${separator}${key}="${value}"${eol}`;
}

function generateSecret() {
  return randomBytes(32).toString("base64");
}

function isIgnoredByGit() {
  const result = spawnSync("git", ["check-ignore", "-q", ".env"], { cwd: ROOT });
  if (result.error) {
    return null; // git não disponível
  }
  return result.status === 0;
}

function isDockerAvailable() {
  const result = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  return !result.error && result.status === 0;
}

function main() {
  const skipDockerCheck = process.argv.includes("--skip-docker-check");

  if (!existsSync(EXAMPLE_PATH)) {
    console.error("✗ .env.example não encontrado na raiz do projeto.");
    process.exit(1);
  }
  const example = readFileSync(EXAMPLE_PATH, "utf8");
  const eol = example.includes("\r\n") ? "\r\n" : "\n";
  const changes = [];

  let text;
  if (existsSync(ENV_PATH)) {
    text = readFileSync(ENV_PATH, "utf8");
    console.log("• .env já existe — valores atuais preservados.");
  } else {
    text = example;
    changes.push(".env criado a partir do .env.example");
  }
  const original = existsSync(ENV_PATH) ? text : null;

  let values = parseEnv(text);

  // Variáveis novas do exemplo que este .env ainda não tem.
  for (const [key, exampleValue] of parseEnv(example)) {
    if (!values.has(key)) {
      text = setValue(text, key, exampleValue, eol);
      if (original !== null) changes.push(`${key} acrescentada (valor do exemplo)`);
    }
  }
  values = parseEnv(text);

  if (!values.get("AUTH_SECRET")) {
    text = setValue(text, "AUTH_SECRET", generateSecret(), eol);
    changes.push("AUTH_SECRET gerado");
  }
  if (!values.get("DATABASE_URL")) {
    text = setValue(text, "DATABASE_URL", COMPOSE_DATABASE_URL, eol);
    changes.push("DATABASE_URL apontado para o Postgres do docker-compose");
  }
  values = parseEnv(text);

  if (original === null) {
    // "wx": falha se outro processo criou o .env no meio do caminho — nunca sobrescreve.
    writeFileSync(ENV_PATH, text, { flag: "wx", mode: 0o600 });
  } else if (text !== original) {
    writeFileSync(ENV_PATH, text);
  }

  for (const change of changes) {
    console.log(`✓ ${change}`);
  }

  // Relatório: só configurada/vazia, nunca o valor.
  console.log("\nVariáveis do .env:");
  const pending = [];
  for (const key of parseEnv(example).keys()) {
    const configured = Boolean(values.get(key));
    const label = configured
      ? "configurada"
      : OPTIONAL_KEYS.has(key)
        ? "vazia (opcional)"
        : "VAZIA";
    console.log(
      `  ${key.padEnd(30)} ${label}${SECRET_KEYS.has(key) && configured ? " (segredo — valor não exibido)" : ""}`,
    );
    if (!configured && !OPTIONAL_KEYS.has(key)) pending.push(key);
  }

  const databaseUrl = values.get("DATABASE_URL") ?? "";
  if (databaseUrl && !databaseUrl.includes("@localhost:5432/aurel")) {
    console.log(
      "\n! DATABASE_URL não aponta para o Postgres do docker-compose (localhost:5432/aurel).\n" +
        "  O contêiner do app usa o Postgres do compose de qualquer forma; esse valor só vale\n" +
        "  para ferramentas rodando no Windows (npm run db:deploy, db:studio, npm run dev).",
    );
  }

  if (pending.includes("TMDB_ACCESS_TOKEN")) {
    console.log(
      "\n! TMDB_ACCESS_TOKEN vazio: o site funciona, mas sem busca/importação da TMDB no painel,\n" +
        '  sem "Onde assistir" e sem reimportação de temporadas. Para ativar, crie um\n' +
        '  "API Read Access Token" em https://www.themoviedb.org/settings/api, cole-o no .env\n' +
        "  (TMDB_ACCESS_TOKEN=...) e rode: docker compose up -d --no-deps --force-recreate app",
    );
  }
  const otherPending = pending.filter((key) => key !== "TMDB_ACCESS_TOKEN");
  if (otherPending.length > 0) {
    console.log(`\n! Preencha no .env: ${otherPending.join(", ")}`);
  }

  const ignored = isIgnoredByGit();
  if (ignored === false) {
    console.error(
      "\n✗ O .env NÃO está ignorado pelo Git. Corrija o .gitignore antes de continuar.",
    );
    process.exit(1);
  }
  console.log(
    ignored === null
      ? "\n! Git não encontrado — não deu para conferir o .gitignore."
      : "\n✓ .env ignorado pelo Git.",
  );

  if (!skipDockerCheck && !isDockerAvailable()) {
    console.error(
      "\n✗ Docker indisponível. Abra o Docker Desktop, espere ele ficar pronto e rode de novo\n" +
        "  `npm run docker:up`. (Nada foi instalado nem alterado além do .env.)",
    );
    process.exit(1);
  }
  if (!skipDockerCheck) console.log("✓ Docker disponível.");
}

main();
