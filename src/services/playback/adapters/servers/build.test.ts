import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildServerAdapters } from "./build";

const LICENSE = "Contrato de licenciamento 123/2026";

const servers = [
  {
    id: "painel",
    label: "Painel",
    kind: "xtream",
    baseUrl: "https://panel.example.com",
    username: "env:PANEL_USER",
    password: "env:PANEL_PASS",
    licenseReference: LICENSE,
  },
  {
    id: "lista",
    label: "Lista",
    kind: "m3u",
    playlistUrl: "https://media.example.com/list.m3u",
    licenseReference: LICENSE,
  },
  {
    id: "arquivos",
    label: "Arquivos",
    kind: "files",
    baseUrl: "https://cdn.example.com/media",
    licenseReference: LICENSE,
  },
  {
    id: "api",
    label: "API",
    kind: "rest",
    baseUrl: "https://api.example.com",
    assetPath: "/v1/videos/{assetId}",
    urlPath: "playback.url",
    searchPath: "/v1/search?q={title}",
    licenseReference: LICENSE,
    allowPrivateNetwork: true,
  },
  {
    id: "sem-segredo",
    label: "Sem segredo",
    kind: "xtream",
    baseUrl: "https://panel2.example.com",
    username: "env:NAO_DEFINIDA",
    password: "x1y2z3",
    licenseReference: LICENSE,
  },
];

describe("buildServerAdapters", () => {
  const warnings: string[] = [];
  const adapters = buildServerAdapters(JSON.stringify(servers), {
    env: { PANEL_USER: "alice", PANEL_PASS: "hunter22" },
    warn: (message) => warnings.push(message),
  });

  it("builds one adapter per valid server, in order", () => {
    assert.deepEqual(
      adapters.map((adapter) => adapter.id),
      ["painel", "lista", "arquivos", "api"],
    );
    assert.equal(warnings.filter((warning) => /NAO_DEFINIDA/.test(warning)).length, 1);
    assert.ok(warnings.every((warning) => !/hunter22|alice|x1y2z3/.test(warning)));
  });

  it("exposes the license reference and the capabilities of each kind", () => {
    const [xtream, m3u, files, rest] = adapters;

    for (const adapter of adapters) {
      assert.equal(adapter.licenseReference, LICENSE);
      assert.ok(adapter.assetIdHint.length > 0);
    }

    assert.equal(typeof xtream.discover, "function");
    assert.equal(typeof xtream.listCatalog, "function");
    assert.equal(typeof m3u.discover, "function");
    assert.equal(typeof m3u.listCatalog, "function");
    assert.equal(files.discover, undefined);
    assert.equal(files.listCatalog, undefined);
    assert.equal(typeof rest.discover, "function");
    assert.equal(rest.listCatalog, undefined);
    assert.equal(rest.allowPrivateNetwork, true);
    assert.equal(files.allowPrivateNetwork, false);
  });

  it("never throws on a broken value", () => {
    const quiet = { env: {}, warn: () => undefined };

    assert.deepEqual(buildServerAdapters(undefined, quiet), []);
    assert.deepEqual(buildServerAdapters("{not json", quiet), []);
    assert.deepEqual(buildServerAdapters("[1,2,3]", quiet), []);
  });
});
