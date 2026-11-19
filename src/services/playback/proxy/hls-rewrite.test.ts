import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasHlsExtension, isHlsContentType, rewriteHlsManifest } from "./hls-rewrite";

const BASE = "https://media.example.org/vod/42/master.m3u8";
const ORIGINS = ["https://media.example.org", "https://cdn.example.org"];

/** Records every URL it is asked to rewrite and answers "P(<url>)". */
function rewriter() {
  const seen: string[] = [];

  return {
    seen,
    rewriteUrl(url: string) {
      seen.push(url);
      return `P(${url})`;
    },
  };
}

function rewrite(manifest: string, baseUrl = BASE, allowedOrigins = ORIGINS) {
  const fake = rewriter();
  const result = rewriteHlsManifest(manifest, {
    baseUrl,
    allowedOrigins,
    rewriteUrl: fake.rewriteUrl,
  });

  return { result, seen: fake.seen };
}

describe("rewriteHlsManifest: master playlist", () => {
  const MASTER = [
    "#EXTM3U",
    "#EXT-X-VERSION:6",
    '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="keys/session.key"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Português",DEFAULT=YES,URI="audio/pt.m3u8"',
    "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS=\"avc1.4d401e,mp4a.40.2\"",
    "360p/index.m3u8",
    "#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720",
    "https://cdn.example.org/720p/index.m3u8?token=abc",
    '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=150000,URI="iframes/360.m3u8"',
    "",
  ].join("\n");

  it("rewrites every URI line and URI attribute, resolving relative ones", () => {
    const { result, seen } = rewrite(MASTER);

    assert.ok(result.ok);
    assert.deepEqual(seen, [
      "https://media.example.org/vod/42/keys/session.key",
      "https://media.example.org/vod/42/audio/pt.m3u8",
      "https://media.example.org/vod/42/360p/index.m3u8",
      "https://cdn.example.org/720p/index.m3u8?token=abc",
      "https://media.example.org/vod/42/iframes/360.m3u8",
    ]);

    const lines = result.manifest.split("\n");

    assert.equal(lines[0], "#EXTM3U");
    assert.ok(lines.includes("P(https://media.example.org/vod/42/360p/index.m3u8)"));
    assert.ok(lines.includes("P(https://cdn.example.org/720p/index.m3u8?token=abc)"));
    assert.ok(
      lines.includes(
        '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="P(https://media.example.org/vod/42/keys/session.key)"',
      ),
    );
    assert.ok(
      lines.includes(
        '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=150000,URI="P(https://media.example.org/vod/42/iframes/360.m3u8)"',
      ),
    );
  });

  it("keeps non-URI attributes, including quoted ones with commas, untouched", () => {
    const { result } = rewrite(MASTER);

    assert.ok(result.ok);
    assert.ok(result.manifest.includes('CODECS="avc1.4d401e,mp4a.40.2"'));
    assert.ok(result.manifest.includes('NAME="Português"'));
    assert.ok(result.manifest.includes("RESOLUTION=1280x720"));
  });

  it("leaves no original upstream URL in the output", () => {
    const { result } = rewrite(MASTER);

    assert.ok(result.ok);

    for (const line of result.manifest.split("\n")) {
      if (line === "" || line.startsWith("#")) {
        continue;
      }

      assert.match(line, /^P\(https:\/\//);
    }
  });
});

describe("rewriteHlsManifest: media playlist", () => {
  const MEDIA = [
    "#EXTM3U",
    "#EXT-X-TARGETDURATION:6",
    "#EXT-X-MEDIA-SEQUENCE:0",
    '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.org/key.bin",IV=0x00000000000000000000000000000001',
    '#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"',
    "#EXTINF:6.0,",
    "seg0.ts",
    "#EXTINF:6.0,",
    "../shared/seg1.ts?x=1#frag",
    "#EXT-X-ENDLIST",
  ].join("\r\n");

  it("rewrites segments, EXT-X-KEY and EXT-X-MAP and normalizes line endings", () => {
    const { result, seen } = rewrite(MEDIA, "https://media.example.org/vod/42/hd/index.m3u8");

    assert.ok(result.ok);
    assert.deepEqual(seen, [
      "https://cdn.example.org/key.bin",
      "https://media.example.org/vod/42/hd/init.mp4",
      "https://media.example.org/vod/42/hd/seg0.ts",
      "https://media.example.org/vod/42/shared/seg1.ts?x=1",
    ]);
    assert.ok(!result.manifest.includes("\r"));
    assert.ok(result.manifest.endsWith("#EXT-X-ENDLIST\n"));
    assert.ok(result.manifest.includes("IV=0x00000000000000000000000000000001"));
    assert.ok(result.manifest.includes('BYTERANGE="720@0"'));
    assert.ok(result.manifest.includes('URI="P(https://cdn.example.org/key.bin)"'));
  });

  it("accepts a BOM and blank lines before #EXTM3U", () => {
    const { result } = rewrite("﻿\n#EXTM3U\n#EXTINF:1,\na.ts\n");

    assert.ok(result.ok);
  });

  it("copes with a playlist that has no URIs at all", () => {
    const { result, seen } = rewrite("#EXTM3U\n#EXT-X-ENDLIST\n");

    assert.ok(result.ok);
    assert.deepEqual(seen, []);
  });
});

describe("rewriteHlsManifest: fail closed", () => {
  const HEAD = "#EXTM3U\n#EXTINF:6,\n";

  it("refuses a segment outside the allowed origins", () => {
    const { result, seen } = rewrite(`${HEAD}https://evil.example.net/seg.ts\n`);

    assert.equal(result.ok, false);
    assert.deepEqual(seen, []);
  });

  it("refuses a URI attribute outside the allowed origins", () => {
    const { result } = rewrite('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://evil.example.net/k"\n');

    assert.equal(result.ok, false);
  });

  it("refuses a different port, a different scheme and look-alike hosts", () => {
    for (const uri of [
      "https://media.example.org:8443/seg.ts",
      "http://media.example.org/seg.ts",
      "https://media.example.org.evil.net/seg.ts",
      "https://evilmedia.example.org/seg.ts",
    ]) {
      assert.equal(rewrite(`${HEAD}${uri}\n`).result.ok, false, uri);
    }
  });

  it("refuses non-http schemes, credentials in the userinfo and protocol-relative hosts", () => {
    for (const uri of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/plain;base64,AAAA",
      "ftp://media.example.org/seg.ts",
      "https://user:pass@media.example.org/seg.ts",
      "//evil.example.net/seg.ts",
    ]) {
      assert.equal(rewrite(`${HEAD}${uri}\n`).result.ok, false, uri);
    }
  });

  it("refuses a malformed URI attribute", () => {
    assert.equal(rewrite("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=key.bin\n").result.ok, false);
    assert.equal(rewrite('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=""\n').result.ok, false);
  });

  it("refuses content that is not an HLS manifest", () => {
    for (const body of ["", "<html>login</html>", "{\"a\":1}", "#EXTINF:1\nseg.ts"]) {
      assert.equal(rewrite(body).result.ok, false, body);
    }
  });

  it("refuses an invalid base URL and ignores invalid origins", () => {
    assert.equal(rewrite("#EXTM3U\na.ts\n", "not a url").result.ok, false);
    assert.equal(rewrite("#EXTM3U\na.ts\n", BASE, ["nope"]).result.ok, false);
  });

  it("refuses the whole manifest when the rewriter throws", () => {
    const result = rewriteHlsManifest("#EXTM3U\na.ts\n", {
      baseUrl: BASE,
      allowedOrigins: ORIGINS,
      rewriteUrl() {
        throw new Error("boom https://media.example.org/secret");
      },
    });

    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes("secret"));
  });

  it("never echoes the offending URL in the reason", () => {
    const { result } = rewrite(`${HEAD}https://evil.example.net/seg.ts?token=hunter2\n`);

    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes("hunter2"));
    assert.ok(!JSON.stringify(result).includes("evil.example.net"));
  });
});

describe("hls detection helpers", () => {
  it("recognizes HLS content types, ignoring case and parameters", () => {
    for (const type of [
      "application/vnd.apple.mpegurl",
      "application/x-mpegURL",
      "audio/mpegurl",
      "audio/x-mpegurl; charset=utf-8",
    ]) {
      assert.equal(isHlsContentType(type), true, type);
    }

    for (const type of ["video/mp4", "text/plain", "", null, undefined]) {
      assert.equal(isHlsContentType(type), false, String(type));
    }
  });

  it("recognizes the .m3u8 extension on the path only", () => {
    assert.equal(hasHlsExtension(new URL("https://h.example.org/a/b.M3U8?x=1")), true);
    assert.equal(hasHlsExtension(new URL("https://h.example.org/a/b.mp4?f=x.m3u8")), false);
  });
});

describe("rewriteHlsManifest: URLs the player would fetch by itself", () => {
  const HEAD = "#EXTM3U\n#EXT-X-VERSION:7\n";

  it("refuses interstitial and steering attributes (they would bypass the proxy)", () => {
    const evil = [
      '#EXT-X-DATERANGE:ID="ad",START-DATE="2026-01-01T00:00:00Z",X-ASSET-URI="https://evil.example.net/ad.m3u8"',
      '#EXT-X-DATERANGE:ID="ad",START-DATE="2026-01-01T00:00:00Z",X-ASSET-LIST="https://evil.example.net/list.json"',
      '#EXT-X-CONTENT-STEERING:SERVER-URI="https://evil.example.net/steer",PATHWAY-ID="a"',
      '#EXT-X-FUTURE:SERVER-URI="https://evil.example.net/x"',
    ];

    for (const line of evil) {
      const { result, seen } = rewrite(`${HEAD}${line}\n#EXTINF:4,\nseg1.ts\n`);

      assert.equal(result.ok, false, line);
      assert.deepEqual(seen, [], line);
      assert.ok(!JSON.stringify(result).includes("evil.example.net"), line);
    }
  });

  it("still rewrites a lower-case uri attribute instead of passing it through", () => {
    const { result, seen } = rewrite(`${HEAD}#EXT-X-MAP:uri="init.mp4"\n#EXTINF:4,\nseg1.ts\n`);

    assert.equal(result.ok, true);
    assert.equal(seen[0], "https://media.example.org/vod/42/init.mp4");
  });
});

describe("rewriteHlsManifest: resource limits", () => {
  it("refuses a manifest with more URIs than the cap", () => {
    const lines = ["#EXTM3U", ...Array.from({ length: 6 }, (_, index) => `s${index}.ts`)];
    const fake = rewriter();
    const result = rewriteHlsManifest(lines.join("\n"), {
      baseUrl: BASE,
      allowedOrigins: ORIGINS,
      rewriteUrl: fake.rewriteUrl,
      maxUris: 5,
    });

    assert.equal(result.ok, false);
    assert.equal(fake.seen.length, 5);
  });

  it("refuses a rewritten manifest that grows past the output cap", () => {
    const lines = ["#EXTM3U", ...Array.from({ length: 50 }, (_, index) => `s${index}.ts`)];
    const result = rewriteHlsManifest(lines.join("\n"), {
      baseUrl: BASE,
      allowedOrigins: ORIGINS,
      rewriteUrl: (url) => `P(${url})`,
      maxOutputChars: 500,
    });

    assert.equal(result.ok, false);
  });
});
