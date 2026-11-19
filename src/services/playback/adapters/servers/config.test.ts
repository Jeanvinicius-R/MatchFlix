import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RESERVED_SERVER_IDS,
  applyAuth,
  collectSecrets,
  describeServer,
  maskUrl,
  parsePlaybackServers,
  redactSecrets,
  resolveSecret,
  type PlaybackServerConfig,
} from "./config";

const LICENSE = "Contrato de licenciamento 123/2026";

const xtream = {
  id: "painel",
  label: "Painel",
  kind: "xtream",
  baseUrl: "https://panel.example.com:8443/",
  username: "user",
  password: "s3cr3t-pass",
  licenseReference: LICENSE,
};

function parse(value: unknown, env: Record<string, string | undefined> = {}) {
  const warnings: string[] = [];
  const servers = parsePlaybackServers(typeof value === "string" ? value : JSON.stringify(value), {
    env,
    warn: (message) => warnings.push(message),
  });

  return { servers, warnings };
}

function only(value: unknown, env: Record<string, string | undefined> = {}) {
  const { servers } = parse([value], env);

  return servers[0] as PlaybackServerConfig | undefined;
}

describe("parsePlaybackServers: valid items", () => {
  it("parses an xtream server and normalizes the base URL", () => {
    const config = only(xtream);

    assert.ok(config && config.kind === "xtream");
    assert.equal(config.baseUrl, "https://panel.example.com:8443");
    assert.equal(config.username, "user");
    assert.equal(config.allowPrivateNetwork, false);
    assert.deepEqual(config.mediaOrigins, []);
    assert.equal(config.licenseReference, LICENSE);
  });

  it("parses every kind", () => {
    const { servers, warnings } = parse([
      xtream,
      {
        id: "lista",
        label: "Lista",
        kind: "m3u",
        playlistUrl: "https://media.example.com/list.m3u?k=1",
        auth: { type: "bearer", token: "tok" },
        mediaOrigins: ["https://cdn.example.com/path/"],
        licenseReference: LICENSE,
      },
      {
        id: "arquivos",
        label: "Arquivos",
        kind: "files",
        baseUrl: "https://cdn.example.com/media/",
        proxy: true,
        licenseReference: LICENSE,
      },
      {
        id: "api",
        label: "API",
        kind: "rest",
        baseUrl: "https://api.example.com",
        assetPath: "/v1/videos/{assetId}",
        urlPath: "playback.url",
        searchPath: "/v1/search?tmdb={tmdbId}&imdb={imdbId}&q={title}&year={year}",
        itemsPath: "results",
        licenseReference: LICENSE,
      },
    ]);

    assert.deepEqual(
      servers.map((server) => [server.id, server.kind]),
      [
        ["painel", "xtream"],
        ["lista", "m3u"],
        ["arquivos", "files"],
        ["api", "rest"],
      ],
    );
    assert.deepEqual(warnings, []);

    const m3u = servers[1];
    const files = servers[2];
    const rest = servers[3];

    assert.ok(m3u.kind === "m3u" && files.kind === "files" && rest.kind === "rest");
    assert.deepEqual(m3u.mediaOrigins, ["https://cdn.example.com"]);
    assert.deepEqual(m3u.auth, { type: "bearer", token: "tok" });
    assert.equal(files.baseUrl, "https://cdn.example.com/media");
    assert.equal(files.proxy, true);
    assert.deepEqual(files.auth, { type: "none" });
    assert.equal(rest.mediaNeedsAuth, false);
    assert.equal(rest.assetPath, "/v1/videos/{assetId}");
  });

  it("resolves env:NAME secrets at parse time", () => {
    const config = only(
      { ...xtream, username: "env:PANEL_USER", password: "env:PANEL_PASS" },
      { PANEL_USER: "  alice ", PANEL_PASS: "hunter22" },
    );

    assert.ok(config && config.kind === "xtream");
    assert.equal(config.username, "alice");
    assert.equal(config.password, "hunter22");
  });

  it("keeps allowPrivateNetwork off unless the operator sets it", () => {
    assert.equal(only(xtream)?.allowPrivateNetwork, false);
    assert.equal(only({ ...xtream, allowPrivateNetwork: false })?.allowPrivateNetwork, false);

    const { servers, warnings } = parse([{ ...xtream, allowPrivateNetwork: true }]);

    assert.equal(servers[0].allowPrivateNetwork, true);
    assert.equal(warnings.filter((warning) => /allowPrivateNetwork/.test(warning)).length, 1);
  });

  it("warns once about plain http and still accepts it for xtream and m3u", () => {
    const { servers, warnings } = parse([
      { ...xtream, baseUrl: "http://192.168.0.10:8080" },
      {
        id: "lista",
        label: "Lista",
        kind: "m3u",
        playlistUrl: "http://192.168.0.10/list.m3u",
        licenseReference: LICENSE,
      },
    ]);

    assert.equal(servers.length, 2);
    assert.equal(warnings.filter((warning) => /usa http/.test(warning)).length, 2);
  });
});

describe("parsePlaybackServers: invalid input never throws", () => {
  it("ignores an unset or empty variable silently", () => {
    assert.deepEqual(parsePlaybackServers(undefined), []);
    assert.deepEqual(parsePlaybackServers("   "), []);
  });

  it("ignores broken JSON without echoing it", () => {
    const { servers, warnings } = parse('[{"id":"x","password":"SEGREDO-123"');

    assert.deepEqual(servers, []);
    assert.equal(warnings.length, 1);
    assert.ok(!warnings[0].includes("SEGREDO-123"));
  });

  it("ignores a value that is not a list", () => {
    const { servers, warnings } = parse({ id: "x" });

    assert.deepEqual(servers, []);
    assert.match(warnings[0], /lista/);
  });

  it("skips bad items, keeps the good ones and never logs a secret", () => {
    const { servers, warnings } = parse([
      { ...xtream, id: "Maiusculas", password: "SEGREDO-AAA" },
      { ...xtream, id: "archive", password: "SEGREDO-BBB" },
      { ...xtream, id: "sem-licenca", licenseReference: "curto", password: "SEGREDO-CCC" },
      { ...xtream, id: "url-ruim", baseUrl: "ftp://x", password: "SEGREDO-DDD" },
      { ...xtream, id: "url-cred", baseUrl: "https://u:p@host.example.com", password: "SEGREDO-EEE" },
      { ...xtream, id: "tipo-ruim", kind: "ftp", password: "SEGREDO-FFF" },
      "texto",
      null,
      { ...xtream, id: "bom" },
      { ...xtream, id: "bom", password: "SEGREDO-GGG" },
    ]);

    assert.deepEqual(
      servers.map((server) => server.id),
      ["bom"],
    );
    assert.equal(warnings.length, 9);
    assert.ok(warnings.every((warning) => !warning.includes("SEGREDO")));
    assert.ok(warnings.some((warning) => /repetido/.test(warning)));
    assert.ok(warnings.some((warning) => /reservado/.test(warning)));
  });

  it("refuses every reserved id", () => {
    for (const id of RESERVED_SERVER_IDS) {
      assert.equal(only({ ...xtream, id }), undefined, id);
    }

    assert.deepEqual([...RESERVED_SERVER_IDS].sort(), [
      "archive",
      "authorized",
      "internet-archive",
      "peertube",
      "youtube",
    ]);
  });

  it("ignores a server whose env secret is missing, naming only the variable", () => {
    const { servers, warnings } = parse([{ ...xtream, password: "env:PANEL_PASS" }], {});

    assert.deepEqual(servers, []);
    assert.match(warnings[0], /PANEL_PASS/);
    assert.match(warnings[0], /não está definida/);
  });

  it("ignores a secret with a line break", () => {
    const { servers, warnings } = parse([{ ...xtream, password: "env:PANEL_PASS" }], {
      PANEL_PASS: "abc\r\nX-Evil: 1",
    });

    assert.deepEqual(servers, []);
    assert.ok(!warnings[0].includes("X-Evil"));
  });

  it("validates files/rest specifics", () => {
    const rest = {
      id: "api",
      label: "API",
      kind: "rest",
      baseUrl: "https://api.example.com",
      assetPath: "/v1/videos/{assetId}",
      urlPath: "playback.url",
      licenseReference: LICENSE,
    };

    assert.ok(only(rest));
    assert.equal(only({ ...rest, baseUrl: "http://api.example.com" }), undefined);
    assert.equal(only({ ...rest, assetPath: "/v1/videos/fixed" }), undefined);
    assert.equal(only({ ...rest, assetPath: "/v1/../videos/{assetId}" }), undefined);
    assert.equal(only({ ...rest, assetPath: "//evil.example.org/{assetId}" }), undefined);
    assert.equal(only({ ...rest, assetPath: "/v1/{other}/{assetId}" }), undefined);
    assert.equal(only({ ...rest, urlPath: "__proto__.x" }), undefined);
    assert.equal(only({ ...rest, urlPath: "a..b" }), undefined);
    assert.equal(only({ ...rest, searchPath: "/s?q={assetId}" }), undefined);
    assert.equal(only({ ...rest, mediaOrigins: ["http://cdn.example.com"] }), undefined);
    assert.equal(
      only({ ...rest, auth: { type: "header", name: "Host", value: "x" } }),
      undefined,
    );
    assert.equal(
      only({ id: "arq", label: "A", kind: "files", baseUrl: "http://cdn.example.com", licenseReference: LICENSE }),
      undefined,
    );
  });
});

describe("resolveSecret", () => {
  it("returns literals and resolves env references", () => {
    assert.equal(resolveSecret("plain", {}), "plain");
    assert.equal(resolveSecret("env:A_B1", { A_B1: " v " }), "v");
  });

  it("throws a value-free error when the variable is unset or empty", () => {
    assert.throws(() => resolveSecret("env:NOPE", {}), /NOPE/);
    assert.throws(() => resolveSecret("env:EMPTY", { EMPTY: "  " }), /EMPTY/);
  });
});

describe("applyAuth", () => {
  const url = "https://api.example.com/v1/x?a=1";

  it("leaves everything alone for none", () => {
    assert.deepEqual(applyAuth({ type: "none" }, url, { A: "1" }), { url, headers: { A: "1" } });
  });

  it("builds bearer, header and basic headers", () => {
    assert.deepEqual(applyAuth({ type: "bearer", token: "tok" }, url).headers, {
      Authorization: "Bearer tok",
    });
    assert.deepEqual(applyAuth({ type: "header", name: "X-Api-Key", value: "k" }, url).headers, {
      "X-Api-Key": "k",
    });
    assert.deepEqual(
      applyAuth({ type: "basic", username: "u", password: "p" }, url).headers,
      { Authorization: `Basic ${Buffer.from("u:p").toString("base64")}` },
    );
  });

  it("puts a query auth in the URL, encoded, replacing an existing parameter", () => {
    const applied = applyAuth({ type: "query", name: "api_key", value: "a b&c" }, url);

    assert.equal(applied.url, "https://api.example.com/v1/x?a=1&api_key=a+b%26c");
    assert.deepEqual(applied.headers, {});

    const replaced = applyAuth(
      { type: "query", name: "a", value: "2" },
      "https://api.example.com/v1/x?a=1",
    );

    assert.equal(replaced.url, "https://api.example.com/v1/x?a=2");
  });

  it("does not mutate the headers it receives", () => {
    const headers = { Accept: "x" };

    applyAuth({ type: "bearer", token: "tok" }, url, headers);
    assert.deepEqual(headers, { Accept: "x" });
  });
});

describe("masking", () => {
  it("keeps only the origin of a URL", () => {
    assert.equal(
      maskUrl("https://user:pw@host.example.com:8443/movie/u/p/1.mp4?token=abc"),
      "https://host.example.com:8443",
    );
    assert.equal(maskUrl("not a url"), "(url inválida)");
  });

  it("describes a server without credentials", () => {
    const config = only({ ...xtream, baseUrl: "https://panel.example.com:8443/secret-path" });

    assert.ok(config);
    assert.equal(describeServer(config), "painel (xtream) em https://panel.example.com:8443");
  });

  it("collects and redacts every secret", () => {
    const config = only({
      id: "lista",
      label: "Lista",
      kind: "m3u",
      playlistUrl: "https://media.example.com/get.m3u?username=alice&password=hunter22",
      auth: { type: "basic", username: "bob", password: "swordfish" },
      licenseReference: LICENSE,
    });

    assert.ok(config);

    const secrets = collectSecrets(config);

    for (const secret of ["bob", "swordfish", "alice", "hunter22"]) {
      assert.ok(secrets.includes(secret), secret);
    }

    assert.equal(
      redactSecrets("falhou com alice/hunter22 e Basic swordfish", config),
      "falhou com ***/*** e Basic ***",
    );
  });
});
