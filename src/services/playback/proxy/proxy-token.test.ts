import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  buildProxyUrl,
  mintProxyToken,
  normalizeOrigin,
  PROXY_PATH_PREFIX,
  readProxyToken,
  resolveProxyTtlSeconds,
  type ProxyTokenInput,
} from "./proxy-token";

const SECRET = "unit-test-secret-0123456789";
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

function input(overrides: Partial<ProxyTokenInput> = {}): ProxyTokenInput {
  return {
    upstreamUrl: "https://media.example.org/vod/42/film.mp4?api_key=hunter2-key",
    headers: { Authorization: "Bearer hunter2-token", "X-Api-Key": "hunter2-header" },
    allowedOrigins: ["https://media.example.org", "https://cdn.example.org"],
    userId: "user-1",
    associationId: "assoc-1",
    ...overrides,
  };
}

function mint(
  overrides: Partial<ProxyTokenInput> = {},
  options: { now?: number; secret?: string; ttlSeconds?: number } = {},
): string {
  return mintProxyToken(input(overrides), { now: NOW, secret: SECRET, ...options });
}

/** Flips one bit of the byte at `index` of the decoded token. */
function flipByte(token: string, index: number): string {
  const raw = Buffer.from(token, "base64url");
  raw[index] ^= 0x01;
  return raw.toString("base64url");
}

describe("mintProxyToken / readProxyToken", () => {
  it("round-trips every field", () => {
    const token = mint({ allowPrivateNetwork: true });
    const payload = readProxyToken(token, { now: NOW + 1000, secret: SECRET });

    assert.deepEqual(payload, {
      upstreamUrl: "https://media.example.org/vod/42/film.mp4?api_key=hunter2-key",
      headers: { Authorization: "Bearer hunter2-token", "X-Api-Key": "hunter2-header" },
      allowedOrigins: ["https://media.example.org", "https://cdn.example.org"],
      userId: "user-1",
      associationId: "assoc-1",
      allowPrivateNetwork: true,
      expiresAt: NOW + 6 * 60 * 60 * 1000,
    });
  });

  it("defaults headers to {} and allowPrivateNetwork to false", () => {
    const token = mint({ headers: undefined });
    const payload = readProxyToken(token, { now: NOW, secret: SECRET });

    assert.deepEqual(payload?.headers, {});
    assert.equal(payload?.allowPrivateNetwork, false);
  });

  it("is URL-safe and never the same twice (random iv)", () => {
    const a = mint();
    const b = mint();

    assert.match(a, /^[A-Za-z0-9_-]+$/);
    assert.notEqual(a, b);
    assert.equal(buildProxyUrl(a), `${PROXY_PATH_PREFIX}${a}`);
    assert.equal(buildProxyUrl(a), `/api/playback/proxy/${a}`);
  });

  it("does not contain the URL, host or any credential, in any common encoding", () => {
    const token = mint();
    const raw = Buffer.from(token, "base64url");
    const views = [
      token,
      raw.toString("utf8"),
      raw.toString("latin1"),
      raw.toString("hex"),
      raw.toString("base64"),
    ];

    for (const view of views) {
      for (const needle of ["hunter2", "api_key", "password", "Bearer", "media.example", "https"]) {
        assert.ok(!view.includes(needle), needle);
      }
    }
  });

  it("returns null when ANY single byte is altered (iv, body or tag)", () => {
    const token = mint();
    const length = Buffer.from(token, "base64url").length;

    for (let index = 0; index < length; index += 1) {
      assert.equal(readProxyToken(flipByte(token, index), { now: NOW, secret: SECRET }), null);
    }
  });

  it("returns null for truncated, extended or non-canonical tokens", () => {
    const token = mint();

    assert.equal(readProxyToken(token.slice(0, -2), { now: NOW, secret: SECRET }), null);
    assert.equal(readProxyToken(`${token}AA`, { now: NOW, secret: SECRET }), null);
    assert.equal(readProxyToken(`${token}=`, { now: NOW, secret: SECRET }), null);
    assert.equal(readProxyToken(token.replace(/[A-Za-z]/, "!"), { now: NOW, secret: SECRET }), null);
  });

  it("returns null for junk", () => {
    for (const junk of ["", "abc", "A".repeat(15), "A".repeat(5000), "../../etc/passwd", "{}"]) {
      assert.equal(readProxyToken(junk, { now: NOW, secret: SECRET }), null, junk.slice(0, 20));
    }

    assert.equal(readProxyToken(undefined as unknown as string, { secret: SECRET }), null);
  });

  it("expires exactly at the TTL", () => {
    const token = mint({}, { ttlSeconds: 600 });

    assert.ok(readProxyToken(token, { now: NOW + 599_000, secret: SECRET }));
    assert.equal(readProxyToken(token, { now: NOW + 600_000, secret: SECRET }), null);
    assert.equal(readProxyToken(token, { now: NOW + 3_600_000, secret: SECRET }), null);
  });

  it("returns null under a different secret", () => {
    const token = mint();

    assert.equal(readProxyToken(token, { now: NOW, secret: `${SECRET}x` }), null);
  });

  it("does not use the raw secret as the key (a token minted with it cannot be forged)", () => {
    // A different secret that shares a prefix must not decrypt either.
    const token = mint({}, { secret: "AUTH_SECRET_A" });

    assert.equal(readProxyToken(token, { now: NOW, secret: "AUTH_SECRET_B" }), null);
    assert.ok(readProxyToken(token, { now: NOW, secret: "AUTH_SECRET_A" }));
  });
});

describe("secret handling", () => {
  const previous = process.env.AUTH_SECRET;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = previous;
    }
  });

  it("throws on mint without any secret, without leaking the URL", () => {
    delete process.env.AUTH_SECRET;

    assert.throws(
      () => mintProxyToken(input()),
      (error: Error) => /AUTH_SECRET/.test(error.message) && !error.message.includes("hunter2"),
    );
    assert.throws(() => mintProxyToken(input(), { secret: "   " }), /AUTH_SECRET/);
  });

  it("returns null (not an exception) on read without any secret", () => {
    const token = mint();
    delete process.env.AUTH_SECRET;

    assert.equal(readProxyToken(token, { now: NOW }), null);
  });

  it("uses AUTH_SECRET from the environment by default", () => {
    process.env.AUTH_SECRET = SECRET;
    const token = mintProxyToken(input(), { now: NOW });

    assert.ok(readProxyToken(token, { now: NOW }));
    assert.ok(readProxyToken(token, { now: NOW, secret: SECRET }));
  });
});

describe("mintProxyToken: input validation", () => {
  const cases: [string, Partial<ProxyTokenInput>][] = [
    ["upstream that is not http(s)", { upstreamUrl: "ftp://media.example.org/x" }],
    ["upstream with credentials in the userinfo", { upstreamUrl: "https://u:p@media.example.org/x" }],
    ["upstream that is not a URL", { upstreamUrl: "not a url" }],
    ["upstream outside allowedOrigins", { upstreamUrl: "https://evil.example.net/x" }],
    ["empty allowedOrigins", { allowedOrigins: [] }],
    ["allowedOrigins with a path-less junk entry", { allowedOrigins: ["media.example.org"] }],
    ["too many allowedOrigins", { allowedOrigins: Array.from({ length: 9 }, (_, i) => `https://h${i}.example.org`) }],
    ["header with CR/LF", { headers: { Authorization: "Bearer x\r\nX-Evil: 1" } }],
    ["header with a bad name", { headers: { "Bad Name": "x" } }],
    ["too many headers", { headers: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`H${i}`, "v"])) }],
    ["empty userId", { userId: "" }],
    ["empty associationId", { associationId: "" }],
    ["non-boolean allowPrivateNetwork", { allowPrivateNetwork: "yes" as unknown as boolean }],
  ];

  for (const [name, overrides] of cases) {
    it(`rejects ${name}`, () => {
      assert.throws(() => mint(overrides));
    });
  }

  it("rejects an invalid ttl", () => {
    assert.throws(() => mint({}, { ttlSeconds: 0 }), /ttlSeconds/);
    assert.throws(() => mint({}, { ttlSeconds: 13 * 60 * 60 }), /ttlSeconds/);
    assert.throws(() => mint({}, { ttlSeconds: 1.5 }), /ttlSeconds/);
  });

  it("never puts the upstream URL or credentials in an error message", () => {
    for (const [, overrides] of cases) {
      try {
        mint(overrides);
      } catch (error) {
        const message = (error as Error).message;

        assert.ok(!message.includes("hunter2"));
        assert.ok(!message.includes("media.example.org"));
      }
    }
  });

  it("normalizes and de-duplicates origins", () => {
    const token = mint({
      allowedOrigins: [
        "https://MEDIA.example.org:443/ignored/path",
        "https://media.example.org",
      ],
    });

    assert.deepEqual(readProxyToken(token, { now: NOW, secret: SECRET })?.allowedOrigins, [
      "https://media.example.org",
    ]);
  });
});

describe("normalizeOrigin", () => {
  it("keeps the port and drops path and default ports", () => {
    assert.equal(normalizeOrigin("https://host.example.org:8443/a/b?x=1"), "https://host.example.org:8443");
    assert.equal(normalizeOrigin("http://host.example.org:80/a"), "http://host.example.org");
  });

  it("refuses non-http schemes, credentials and junk", () => {
    for (const value of ["file:///etc/passwd", "javascript:alert(1)", "https://u:p@h.example.org", "nope", "", 42, null]) {
      assert.equal(normalizeOrigin(value), null, String(value));
    }
  });
});

describe("resolveProxyTtlSeconds", () => {
  it("defaults to 6 hours", () => {
    assert.equal(resolveProxyTtlSeconds(undefined), 21_600);
    assert.equal(resolveProxyTtlSeconds(""), 21_600);
  });

  it("accepts 300..43200 and falls back to the default for anything else", () => {
    assert.equal(resolveProxyTtlSeconds("300"), 300);
    assert.equal(resolveProxyTtlSeconds("43200"), 43_200);

    for (const raw of ["299", "43201", "abc", "-5", "1.5", "NaN"]) {
      assert.equal(resolveProxyTtlSeconds(raw), 21_600, raw);
    }
  });
});
