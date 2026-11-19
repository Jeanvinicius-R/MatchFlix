import { z } from "zod";
import { isValidJsonPath } from "./json-path";

/**
 * PLAYBACK_SERVERS: the operator's own / licensed media servers, as a JSON
 * array in one env var. Each item becomes one PlaybackAdapter (see build.ts).
 *
 * Rules:
 *   - an invalid item is ignored with a warning that never carries a value
 *     (only the item position/id, the field name and a generic message);
 *   - a broken variable never breaks the import: parsePlaybackServers never throws;
 *   - secrets accept "env:NAME" (read from the environment at parse time; an
 *     unset variable => the server is ignored);
 *   - `licenseReference` (the contract / proof for the whole catalog) is required.
 *
 * Nothing here makes anything playable: the admin still approves each title.
 *
 * Network rules (see proxy/safe-fetch.ts): the backend refuses to connect to
 * private/loopback/link-local addresses unless the operator sets
 * `allowPrivateNetwork: true` on that server. `mediaOrigins` lists the extra
 * origins media may live on (CDNs); playlist/JSON content is never trusted to
 * name an origin by itself. NOTE: `allowPrivateNetwork` is one flag per server
 * and also covers its `mediaOrigins`, so with it on they must be trusted hosts.
 */

export type ServerKind = "xtream" | "m3u" | "files" | "rest";

export type ServerAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "header"; name: string; value: string }
  | { type: "query"; name: string; value: string }
  | { type: "basic"; username: string; password: string };

interface ServerConfigBase {
  id: string;
  label: string;
  licenseReference: string;
  /** Operator opt-in: the server lives on a private network (default false). */
  allowPrivateNetwork: boolean;
}

export interface XtreamServerConfig extends ServerConfigBase {
  kind: "xtream";
  /** Origin + optional path, no trailing slash. http is accepted (server-side only). */
  baseUrl: string;
  username: string;
  password: string;
  /** Extra origins media may be served from (normalized, e.g. "https://cdn.example.com"). */
  mediaOrigins: string[];
}

export interface M3uServerConfig extends ServerConfigBase {
  kind: "m3u";
  playlistUrl: string;
  auth: ServerAuth;
  mediaOrigins: string[];
}

export interface FilesServerConfig extends ServerConfigBase {
  kind: "files";
  /** https origin + optional path, no trailing slash. */
  baseUrl: string;
  auth: ServerAuth;
  proxy: boolean;
}

export interface RestServerConfig extends ServerConfigBase {
  kind: "rest";
  /** https origin + optional path, no trailing slash. */
  baseUrl: string;
  auth: ServerAuth;
  assetPath: string;
  urlPath: string;
  typePath?: string;
  mediaNeedsAuth: boolean;
  mediaOrigins: string[];
  searchPath?: string;
  itemsPath?: string;
  idPath?: string;
  titlePath?: string;
  yearPath?: string;
  tmdbPath?: string;
  imdbPath?: string;
}

export type PlaybackServerConfig =
  | XtreamServerConfig
  | M3uServerConfig
  | FilesServerConfig
  | RestServerConfig;

/** Ids used by built-in adapters/providers: a configured server can never shadow them. */
export const RESERVED_SERVER_IDS: ReadonlySet<string> = new Set([
  "archive",
  "peertube",
  "internet-archive",
  "authorized",
  "youtube",
]);

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,29}$/;

/** Headers the transport owns; a configured auth header may not replace them. */
const FORBIDDEN_HEADER_NAMES: ReadonlySet<string> = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "cookie",
  "set-cookie",
  "upgrade",
  "range",
  "accept",
  "user-agent",
]);

function isWebUrl(
  value: string,
  options: { httpsOnly: boolean; allowQuery: boolean },
): boolean {
  try {
    const url = new URL(value);

    return (
      (url.protocol === "https:" || (!options.httpsOnly && url.protocol === "http:")) &&
      url.hostname !== "" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      (options.allowQuery || url.search === "")
    );
  } catch {
    return false;
  }
}

/** "/v1/videos/{assetId}": absolute path, only the allowed {placeholders}, no "..". */
function isSafePathTemplate(value: string, placeholders: readonly string[]): boolean {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\s\\#]/.test(value) ||
    value.includes("..")
  ) {
    return false;
  }

  const rest = value.replace(/\{([A-Za-z]+)\}/g, (match: string, name: string) =>
    placeholders.includes(name) ? "" : match,
  );

  return !/[{}]/.test(rest);
}

function pathTemplate(placeholders: readonly string[]) {
  return z
    .string()
    .trim()
    .max(300)
    .refine((value) => isSafePathTemplate(value, placeholders), "caminho inválido");
}

const secretText = z.string().trim().min(1).max(2000);
const dotPath = z.string().trim().refine(isValidJsonPath, "caminho inválido");

const authSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), token: secretText }),
  z.object({
    type: z.literal("header"),
    name: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,64}$/, "nome de cabeçalho inválido")
      .refine((name) => !FORBIDDEN_HEADER_NAMES.has(name.toLowerCase()), "cabeçalho reservado"),
    value: secretText,
  }),
  z.object({
    type: z.literal("query"),
    name: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.-]{1,64}$/, "nome de parâmetro inválido"),
    value: secretText,
  }),
  z.object({ type: z.literal("basic"), username: secretText, password: secretText }),
]);

/** Fewer than the proxy token's origin cap (8), leaving room for the server itself. */
const MAX_MEDIA_ORIGINS = 5;

function mediaOriginList(httpsOnly: boolean) {
  return z
    .array(
      z
        .string()
        .trim()
        .refine(
          (value) => isWebUrl(value, { httpsOnly, allowQuery: false }),
          "origem de mídia inválida",
        ),
    )
    .max(MAX_MEDIA_ORIGINS)
    .optional();
}

const commonFields = {
  id: z
    .string()
    .regex(ID_PATTERN, "id inválido")
    .refine((id) => !RESERVED_SERVER_IDS.has(id), "id reservado"),
  label: z.string().trim().min(1).max(60),
  licenseReference: z.string().trim().min(10, "licenseReference muito curto").max(300),
  allowPrivateNetwork: z.boolean().optional(),
};

const serverSchema = z.discriminatedUnion("kind", [
  z.object({
    ...commonFields,
    kind: z.literal("xtream"),
    baseUrl: z
      .string()
      .trim()
      .refine((v) => isWebUrl(v, { httpsOnly: false, allowQuery: false }), "baseUrl inválida"),
    username: secretText,
    password: secretText,
    mediaOrigins: mediaOriginList(false),
  }),
  z.object({
    ...commonFields,
    kind: z.literal("m3u"),
    playlistUrl: z
      .string()
      .trim()
      .refine((v) => isWebUrl(v, { httpsOnly: false, allowQuery: true }), "playlistUrl inválida"),
    auth: authSchema.optional(),
    mediaOrigins: mediaOriginList(false),
  }),
  z.object({
    ...commonFields,
    kind: z.literal("files"),
    baseUrl: z
      .string()
      .trim()
      .refine((v) => isWebUrl(v, { httpsOnly: true, allowQuery: false }), "baseUrl inválida"),
    auth: authSchema.optional(),
    proxy: z.boolean().optional(),
  }),
  z.object({
    ...commonFields,
    kind: z.literal("rest"),
    baseUrl: z
      .string()
      .trim()
      .refine((v) => isWebUrl(v, { httpsOnly: true, allowQuery: false }), "baseUrl inválida"),
    auth: authSchema.optional(),
    assetPath: pathTemplate(["assetId"]).refine(
      (v) => v.includes("{assetId}"),
      "assetPath precisa de {assetId}",
    ),
    urlPath: dotPath,
    typePath: dotPath.optional(),
    mediaNeedsAuth: z.boolean().optional(),
    mediaOrigins: mediaOriginList(true),
    searchPath: pathTemplate(["tmdbId", "imdbId", "title", "year"]).optional(),
    itemsPath: dotPath.optional(),
    idPath: dotPath.optional(),
    titlePath: dotPath.optional(),
    yearPath: dotPath.optional(),
    tmdbPath: dotPath.optional(),
    imdbPath: dotPath.optional(),
  }),
]);

type RawServer = z.infer<typeof serverSchema>;
type RawAuth = z.infer<typeof authSchema>;

type Env = Record<string, string | undefined>;

/** A reason safe to log: names the env variable, never a value. */
class ServerConfigError extends Error {}

const ENV_REFERENCE = /^env:([A-Za-z_][A-Za-z0-9_]{0,63})$/;

/** "env:NAME" -> process value (throws when unset); anything else is the literal. */
export function resolveSecret(value: string, env: Env): string {
  const match = ENV_REFERENCE.exec(value);
  const resolved = match ? env[match[1]]?.trim() : value;

  if (resolved === undefined || resolved === "") {
    throw new ServerConfigError(
      `a variável de ambiente "${match ? match[1] : "?"}" não está definida`,
    );
  }

  // A header/query value with a line break would be a request-splitting vector.
  if (/[\r\n\0]/.test(resolved)) {
    throw new ServerConfigError("um segredo contém caracteres inválidos");
  }

  return resolved;
}

function resolveAuth(auth: RawAuth | undefined, env: Env): ServerAuth {
  if (!auth) {
    return { type: "none" };
  }

  switch (auth.type) {
    case "none":
      return { type: "none" };
    case "bearer":
      return { type: "bearer", token: resolveSecret(auth.token, env) };
    case "header":
      return { type: "header", name: auth.name, value: resolveSecret(auth.value, env) };
    case "query":
      return { type: "query", name: auth.name, value: resolveSecret(auth.value, env) };
    case "basic":
      return {
        type: "basic",
        username: resolveSecret(auth.username, env),
        password: resolveSecret(auth.password, env),
      };
  }
}

/** Origin + path without the trailing slash ("https://cdn.example.com/media"). */
function normalizeBase(raw: string): string {
  const url = new URL(raw);

  return url.origin + url.pathname.replace(/\/+$/, "");
}

/** Distinct "scheme://host[:port]" of the listed URLs. */
function normalizeOrigins(raw: string[] | undefined): string[] {
  return [...new Set((raw ?? []).map((value) => new URL(value).origin))];
}

function resolveServer(raw: RawServer, env: Env): PlaybackServerConfig {
  const base = {
    id: raw.id,
    label: raw.label,
    licenseReference: raw.licenseReference,
    allowPrivateNetwork: raw.allowPrivateNetwork === true,
  };

  switch (raw.kind) {
    case "xtream":
      return {
        ...base,
        kind: "xtream",
        baseUrl: normalizeBase(raw.baseUrl),
        username: resolveSecret(raw.username, env),
        password: resolveSecret(raw.password, env),
        mediaOrigins: normalizeOrigins(raw.mediaOrigins),
      };
    case "m3u":
      return {
        ...base,
        kind: "m3u",
        playlistUrl: new URL(raw.playlistUrl).toString(),
        auth: resolveAuth(raw.auth, env),
        mediaOrigins: normalizeOrigins(raw.mediaOrigins),
      };
    case "files":
      return {
        ...base,
        kind: "files",
        baseUrl: normalizeBase(raw.baseUrl),
        auth: resolveAuth(raw.auth, env),
        proxy: raw.proxy === true,
      };
    case "rest":
      return {
        ...base,
        kind: "rest",
        baseUrl: normalizeBase(raw.baseUrl),
        auth: resolveAuth(raw.auth, env),
        assetPath: raw.assetPath,
        urlPath: raw.urlPath,
        typePath: raw.typePath,
        mediaNeedsAuth: raw.mediaNeedsAuth === true,
        mediaOrigins: normalizeOrigins(raw.mediaOrigins),
        searchPath: raw.searchPath,
        itemsPath: raw.itemsPath,
        idPath: raw.idPath,
        titlePath: raw.titlePath,
        yearPath: raw.yearPath,
        tmdbPath: raw.tmdbPath,
        imdbPath: raw.imdbPath,
      };
  }
}

export interface ParseServersOptions {
  /** Defaults to process.env. */
  env?: Env;
  /** Defaults to console.warn. Messages never contain secrets. */
  warn?: (message: string) => void;
}

/** "servidor #2" / "servidor \"cdn-main\"": only a well-formed id is ever echoed. */
function describeItem(item: unknown, index: number): string {
  const id =
    typeof item === "object" && item !== null
      ? (item as { id?: unknown }).id
      : undefined;

  return typeof id === "string" && ID_PATTERN.test(id)
    ? `servidor "${id}"`
    : `servidor #${index + 1}`;
}

/** Whether a server is reached over plain http (only the backend ever contacts it). */
function usesPlainHttp(config: PlaybackServerConfig): boolean {
  if (config.kind === "xtream") {
    return config.baseUrl.startsWith("http:");
  }

  return config.kind === "m3u" && config.playlistUrl.startsWith("http:");
}

/**
 * Parses the PLAYBACK_SERVERS value. Never throws: a broken value or item is
 * skipped with a warning (no credentials, no raw content, no parser messages
 * because a JSON.parse error can quote the input).
 */
export function parsePlaybackServers(
  raw: string | undefined,
  options: ParseServersOptions = {},
): PlaybackServerConfig[] {
  const env = options.env ?? process.env;
  const warn = options.warn ?? ((message: string) => console.warn(message));

  if (raw === undefined || raw.trim() === "") {
    return [];
  }

  let data: unknown;

  try {
    data = JSON.parse(raw);
  } catch {
    warn("PLAYBACK_SERVERS ignorado: o valor não é um JSON válido.");
    return [];
  }

  if (!Array.isArray(data)) {
    warn("PLAYBACK_SERVERS ignorado: o valor precisa ser uma lista (array JSON).");
    return [];
  }

  const servers: PlaybackServerConfig[] = [];
  const seen = new Set<string>();

  (data as unknown[]).forEach((item, index) => {
    const name = describeItem(item, index);

    try {
      const parsed = serverSchema.safeParse(item);

      if (!parsed.success) {
        const problems = parsed.error.issues
          .slice(0, 3)
          .map((issue) => {
            const field = issue.path.map(String).join(".");
            return field ? `${field}: ${issue.message}` : issue.message;
          })
          .join("; ");

        warn(`PLAYBACK_SERVERS: ${name} ignorado (${problems}).`);
        return;
      }

      if (seen.has(parsed.data.id)) {
        warn(`PLAYBACK_SERVERS: ${name} ignorado (id repetido).`);
        return;
      }

      const config = resolveServer(parsed.data, env);

      seen.add(config.id);
      servers.push(config);

      if (usesPlainHttp(config)) {
        warn(
          `PLAYBACK_SERVERS: ${name} usa http. Tudo bem para o backend, mas o tráfego ` +
            "não é criptografado (o navegador nunca contata o servidor).",
        );
      }

      if (config.allowPrivateNetwork) {
        warn(
          `PLAYBACK_SERVERS: ${name} tem allowPrivateNetwork ativo; o backend poderá ` +
            "conectar a endereços de rede privada para este servidor e para os seus " +
            "mediaOrigins (a permissão vale para todo o token; só liste origens de confiança).",
        );
      }
    } catch (error) {
      // Only our own errors carry a message that is safe to show.
      warn(
        `PLAYBACK_SERVERS: ${name} ignorado (${
          error instanceof ServerConfigError ? error.message : "configuração inválida"
        }).`,
      );
    }
  });

  return servers;
}

/** The request headers/URL a server's AUTH asks for. Pure: nothing is mutated. */
export function applyAuth(
  auth: ServerAuth,
  url: string,
  headers: Record<string, string> = {},
): { url: string; headers: Record<string, string> } {
  const out: Record<string, string> = { ...headers };

  switch (auth.type) {
    case "none":
      return { url, headers: out };
    case "bearer":
      out.Authorization = `Bearer ${auth.token}`;
      return { url, headers: out };
    case "header":
      out[auth.name] = auth.value;
      return { url, headers: out };
    case "basic":
      out.Authorization = `Basic ${Buffer.from(
        `${auth.username}:${auth.password}`,
        "utf8",
      ).toString("base64")}`;
      return { url, headers: out };
    case "query": {
      const target = new URL(url);

      target.searchParams.set(auth.name, auth.value);
      return { url: target.toString(), headers: out };
    }
  }
}

/** Only "scheme://host[:port]": paths and queries often carry credentials. */
export function maskUrl(raw: string): string {
  try {
    return new URL(raw).origin;
  } catch {
    return "(url inválida)";
  }
}

/** One-line description of a server that is safe for logs. */
export function describeServer(config: PlaybackServerConfig): string {
  const where = maskUrl(config.kind === "m3u" ? config.playlistUrl : config.baseUrl);

  return `${config.id} (${config.kind}) em ${where}`;
}

function authSecrets(auth: ServerAuth): string[] {
  switch (auth.type) {
    case "none":
      return [];
    case "bearer":
      return [auth.token];
    case "header":
    case "query":
      return [auth.value];
    case "basic":
      return [auth.username, auth.password];
  }
}

/** Every secret value of a server (for redaction). */
export function collectSecrets(config: PlaybackServerConfig): string[] {
  const secrets: string[] = [];

  if (config.kind === "xtream") {
    secrets.push(config.username, config.password);
  } else {
    secrets.push(...authSecrets(config.auth));
  }

  if (config.kind === "m3u") {
    new URL(config.playlistUrl).searchParams.forEach((value) => secrets.push(value));
  }

  return secrets.filter((secret) => secret.length >= 3);
}

/** `text` with every secret of `config` replaced by "***". */
export function redactSecrets(text: string, config: PlaybackServerConfig): string {
  return collectSecrets(config).reduce((acc, secret) => acc.split(secret).join("***"), text);
}
