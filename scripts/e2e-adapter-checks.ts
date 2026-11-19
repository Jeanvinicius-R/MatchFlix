import { mkdirSync, writeFileSync } from "node:fs";
import config from "../e2e/e2e-config.json";
import { isAdapterFailure } from "../src/services/playback/adapters/adapter.types";
import { buildServerAdapters } from "../src/services/playback/adapters/servers/build";

/**
 * Adapter-level checks of the e2e job that need no browser: the REAL server
 * adapters (xtream) against the local mock, with the PLAYBACK_SERVERS the Next
 * server uses (see e2e/servers-env.mjs).
 *
 *   - a server on 127.0.0.1 WITHOUT allowPrivateNetwork is refused with a reason
 *     (SSRF guard), before any connection is made;
 *   - a server on the cloud metadata address is refused the same way;
 *   - positive control: the same panel WITH allowPrivateNetwork resolves, as
 *     proxied media (never a public URL) limited to its own origin.
 *
 * Writes e2e-out/adapter-checks.json for e2e/playback.e2e.mjs (the final report).
 * Exit code 1 when a check fails.
 */

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "OK  " : "FAIL"} ${name} — ${detail}`);
}

const REFUSAL = /privad|reservad|allowPrivateNetwork/i;
const CREDENTIALS = [config.mock.xtreamUser, config.mock.xtreamPass];

function leaksCredentials(text: string): boolean {
  return CREDENTIALS.some((secret) => text.includes(secret));
}

async function main() {
  const signal = () => ({ signal: AbortSignal.timeout(20_000) });
  const adapters = buildServerAdapters(process.env.PLAYBACK_SERVERS);
  const byId = new Map(adapters.map((adapter) => [adapter.id, adapter] as const));

  // 1) 127.0.0.1 without the operator's opt-in.
  const blocked = byId.get("blocked-mock");

  if (!blocked) {
    record("servidor sem allowPrivateNetwork", false, "adaptador blocked-mock não foi carregado");
  } else {
    const result = await blocked.resolve("vod:1", signal());

    if (!isAdapterFailure(result)) {
      record("servidor sem allowPrivateNetwork", false, "a resolução NÃO foi recusada");
    } else {
      record(
        "servidor sem allowPrivateNetwork",
        REFUSAL.test(result.reason) && !leaksCredentials(result.reason),
        `recusado com o motivo: ${result.reason}`,
      );
    }
  }

  // 2) The cloud metadata address, as a literal IP in a configured server.
  const metadata = buildServerAdapters(
    JSON.stringify([
      {
        id: "metadata-mock",
        label: "Metadata (mock E2E)",
        kind: "xtream",
        baseUrl: "http://169.254.169.254",
        username: "u-e2e-check",
        password: "p-e2e-check",
        licenseReference: config.licenseReference,
      },
    ]),
  )[0];

  if (!metadata) {
    record("endereço de metadata 169.254.169.254", false, "adaptador não foi carregado");
  } else {
    const result = await metadata.resolve("vod:1", signal());

    record(
      "endereço de metadata 169.254.169.254",
      isAdapterFailure(result) && REFUSAL.test(result.reason),
      isAdapterFailure(result) ? `recusado: ${result.reason}` : "NÃO foi recusado",
    );
  }

  // 3) Positive control: the declared private-network server works, via the proxy.
  const allowed = byId.get("xtream-mock");

  if (!allowed) {
    record("servidor com allowPrivateNetwork", false, "adaptador xtream-mock não foi carregado");
  } else {
    const result = await allowed.resolve("vod:1", signal());

    if (isAdapterFailure(result)) {
      record("servidor com allowPrivateNetwork", false, `falhou: ${result.reason}`);
    } else {
      const origin = `http://${config.mock.host}:${config.mock.port}`;
      const proxy = result.proxy;
      const ok =
        result.url === undefined &&
        proxy !== undefined &&
        proxy.allowPrivateNetwork === true &&
        proxy.allowedOrigins.length === 1 &&
        proxy.allowedOrigins[0] === origin;

      record(
        "servidor com allowPrivateNetwork",
        ok,
        ok
          ? "resolveu como mídia via proxy, só para a própria origem do servidor"
          : "a resposta não veio como mídia via proxy restrita à origem do servidor",
      );
    }
  }

  mkdirSync("e2e-out", { recursive: true });
  writeFileSync("e2e-out/adapter-checks.json", `${JSON.stringify(results, null, 2)}\n`);

  if (results.some((result) => !result.pass)) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error("Erro inesperado em e2e-adapter-checks:", error);
  process.exit(1);
});
