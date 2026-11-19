import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * The registry reads PLAYBACK_SERVERS when it is first loaded, so the variable is
 * set before the module is imported (each test file runs in its own process).
 */
describe("adapter registry", () => {
  it("keeps the built-in adapters and adds the configured servers", async () => {
    const originalWarn = console.warn;
    const warnings: string[] = [];

    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    process.env.PLAYBACK_SERVERS = JSON.stringify([
      {
        id: "arquivos",
        label: "Arquivos",
        kind: "files",
        baseUrl: "https://cdn.example.com/media",
        licenseReference: "Obras de domínio público do acervo",
      },
      {
        id: "archive",
        label: "Tentativa de sobrescrever",
        kind: "files",
        baseUrl: "https://evil.example.org",
        licenseReference: "Obras de domínio público do acervo",
      },
    ]);

    try {
      const { adapters, findAdapter } = await import("./registry");

      assert.deepEqual(
        adapters.map((adapter) => adapter.id),
        ["archive", "peertube", "arquivos"],
      );
      assert.equal(findAdapter("arquivos")?.label, "Arquivos");
      assert.equal(findAdapter("archive")?.label !== "Tentativa de sobrescrever", true);
      assert.equal(findAdapter("nope"), undefined);
      assert.equal(warnings.filter((warning) => /reservado/.test(warning)).length, 1);
    } finally {
      console.warn = originalWarn;
    }
  });
});
