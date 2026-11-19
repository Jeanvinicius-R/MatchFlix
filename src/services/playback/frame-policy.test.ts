import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFramePolicy, listFrameOrigins } from "./frame-policy";

const embed = (overrides: Record<string, unknown> = {}) => ({
  id: "player-externo",
  label: "Player",
  kind: "embed",
  baseUrl: "https://player.example.com",
  identifierType: "tmdb",
  movieTemplate: "/embed/movie/{tmdbId}",
  licenseReference: "Contrato 123/2026 com o distribuidor X",
  ...overrides,
});

describe("listFrameOrigins", () => {
  it("always has the built-in embed origins and nothing else by default", () => {
    assert.deepEqual(listFrameOrigins({}), [
      "https://www.youtube.com",
      "https://www.youtube-nocookie.com",
      "https://archive.org",
    ]);
  });

  it("adds the authorized base URL origin and enabled embed servers only", () => {
    const origins = listFrameOrigins({
      PLAYBACK_AUTHORIZED_BASE_URL: "https://autorizado.example.org/base/path",
      PLAYBACK_SERVERS: JSON.stringify([
        embed(),
        embed({ id: "desligado", baseUrl: "https://off.example.com", enabled: false }),
        { ...embed({ id: "outro" }), kind: "files", baseUrl: "https://files.example.com", auth: undefined },
      ]),
    });

    assert.ok(origins.includes("https://autorizado.example.org"));
    assert.ok(origins.includes("https://player.example.com"));
    assert.ok(!origins.includes("https://off.example.com"));
    assert.ok(!origins.includes("https://files.example.com"));
  });

  it("ignores a broken PLAYBACK_SERVERS and a junk authorized URL", () => {
    assert.equal(
      listFrameOrigins({ PLAYBACK_SERVERS: "{not json", PLAYBACK_AUTHORIZED_BASE_URL: "javascript:x" }).length,
      3,
    );
  });
});

describe("buildFramePolicy", () => {
  it("never lets MatchFlix be framed and lists the frame sources", () => {
    const policy = buildFramePolicy({
      PLAYBACK_SERVERS: JSON.stringify([embed()]),
    });

    assert.match(policy, /^frame-ancestors 'none'; frame-src 'self' /);
    assert.match(policy, /https:\/\/player\.example\.com/);
    assert.doesNotMatch(policy, /\*/);
  });
});
