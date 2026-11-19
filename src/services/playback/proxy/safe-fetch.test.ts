import assert from "node:assert/strict";
import http, { type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import {
  createSafeFetch,
  isBlockedAddress,
  resolveSafeAddresses,
  SafeFetchError,
  type LookupFn,
} from "./safe-fetch";

function lookupTo(...addresses: string[]): LookupFn {
  return async () =>
    addresses.map((address) => ({
      address,
      family: (address.includes(":") ? 6 : 4) as 4 | 6,
    }));
}

function refusedWith(code: string) {
  return (error: unknown) => error instanceof SafeFetchError && error.code === code;
}

describe("isBlockedAddress: IPv4", () => {
  const BLOCKED = [
    "0.0.0.0",
    "0.255.255.255",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.0",
    "100.127.255.255",
    "127.0.0.1",
    "127.255.255.255",
    "169.254.0.1",
    "169.254.169.254",
    "172.16.0.0",
    "172.31.255.255",
    "192.0.0.1",
    "192.168.0.1",
    "192.168.255.255",
    "198.18.0.0",
    "198.19.255.255",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
  ];
  const PUBLIC = [
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "9.255.255.255",
    "11.0.0.0",
    "100.63.255.255",
    "100.128.0.0",
    "126.255.255.255",
    "128.0.0.1",
    "169.253.255.255",
    "169.255.0.0",
    "172.15.255.255",
    "172.32.0.0",
    "192.0.1.1",
    "192.167.255.255",
    "192.169.0.0",
    "198.17.255.255",
    "198.20.0.0",
    "223.255.255.255",
  ];

  for (const address of BLOCKED) {
    it(`blocks ${address}`, () => assert.equal(isBlockedAddress(address), true));
  }

  for (const address of PUBLIC) {
    it(`allows ${address}`, () => assert.equal(isBlockedAddress(address), false));
  }

  it("fails closed on anything that is not a clean IP literal", () => {
    for (const value of [
      "",
      "localhost",
      "not-an-ip",
      "999.1.1.1",
      "1.2.3",
      "1.2.3.4.5",
      "010.0.0.1",
      "127.1",
      "0x7f.0.0.1",
      "2130706433",
      " 8.8.8.8",
      "8.8.8.8 ",
      "gggg::1",
      null as unknown as string,
      undefined as unknown as string,
    ]) {
      assert.equal(isBlockedAddress(value), true, String(value));
    }
  });
});

describe("isBlockedAddress: IPv6", () => {
  const BLOCKED = [
    "::",
    "::1",
    "0:0:0:0:0:0:0:1",
    "fc00::1",
    "fd12:3456:789a::1",
    "fe80::1",
    "fe80::1%eth0",
    "febf::1",
    "ff02::1",
    "ff00::",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "::ffff:192.168.1.1",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "0:0:0:0:0:ffff:7f00:1",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "64:ff9b::a00:1",
    "2002:7f00:1::",
    "2002:a9fe:a9fe::1",
    "2001:db8::1",
    "2001::1",
  ];
  const PUBLIC = [
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "2a00:1450:4001:81b::200e",
    "::ffff:8.8.8.8",
    "::ffff:0808:0808",
    "64:ff9b::808:808",
    "2002:808:808::1",
  ];

  for (const address of BLOCKED) {
    it(`blocks ${address}`, () => assert.equal(isBlockedAddress(address), true));
  }

  for (const address of PUBLIC) {
    it(`allows ${address}`, () => assert.equal(isBlockedAddress(address), false));
  }
});

describe("resolveSafeAddresses", () => {
  it("returns every public address of a host, de-duplicated", async () => {
    const addresses = await resolveSafeAddresses("media.example.org", {
      lookup: lookupTo("93.184.216.34", "2606:4700::1111", "93.184.216.34"),
    });

    assert.deepEqual(addresses, [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700::1111", family: 6 },
    ]);
  });

  it("refuses the host when ANY of its addresses is private (one public A is not enough)", async () => {
    for (const bad of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.5"]) {
      await assert.rejects(
        resolveSafeAddresses("media.example.org", { lookup: lookupTo("93.184.216.34", bad) }),
        refusedWith("BLOCKED_ADDRESS"),
        bad,
      );
      await assert.rejects(
        resolveSafeAddresses("media.example.org", { lookup: lookupTo(bad, "93.184.216.34") }),
        refusedWith("BLOCKED_ADDRESS"),
        bad,
      );
    }
  });

  it("refuses a record that is not an IP at all", async () => {
    await assert.rejects(
      resolveSafeAddresses("media.example.org", { lookup: lookupTo("not-an-ip") }),
      refusedWith("BLOCKED_ADDRESS"),
    );
  });

  it("validates literal IP hosts directly, without any lookup", async () => {
    let lookups = 0;
    const lookup: LookupFn = async () => {
      lookups += 1;
      return [{ address: "93.184.216.34", family: 4 }];
    };

    for (const host of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "[::1]", "::1", "[fe80::1]", "[::ffff:10.0.0.1]"]) {
      await assert.rejects(resolveSafeAddresses(host, { lookup }), refusedWith("BLOCKED_ADDRESS"), host);
    }

    assert.deepEqual(await resolveSafeAddresses("8.8.8.8", { lookup }), [
      { address: "8.8.8.8", family: 4 },
    ]);
    assert.deepEqual(await resolveSafeAddresses("[2606:4700::1111]", { lookup }), [
      { address: "2606:4700::1111", family: 6 },
    ]);
    assert.equal(lookups, 0);
  });

  it("allows private addresses only with the operator's explicit allowPrivateNetwork", async () => {
    const options = { lookup: lookupTo("192.168.1.20") };

    await assert.rejects(resolveSafeAddresses("nas.lan", options), refusedWith("BLOCKED_ADDRESS"));
    await assert.rejects(
      resolveSafeAddresses("nas.lan", { ...options, allowPrivateNetwork: false }),
      refusedWith("BLOCKED_ADDRESS"),
    );
    assert.deepEqual(
      await resolveSafeAddresses("nas.lan", { ...options, allowPrivateNetwork: true }),
      [{ address: "192.168.1.20", family: 4 }],
    );
    assert.deepEqual(
      await resolveSafeAddresses("192.168.1.20", { allowPrivateNetwork: true }),
      [{ address: "192.168.1.20", family: 4 }],
    );
    assert.deepEqual(await resolveSafeAddresses("[::1]", { allowPrivateNetwork: true }), [
      { address: "::1", family: 6 },
    ]);
  });

  it("reports resolution failures", async () => {
    await assert.rejects(
      resolveSafeAddresses("nope.example.org", {
        lookup: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
      refusedWith("DNS_FAILED"),
    );
    await assert.rejects(
      resolveSafeAddresses("empty.example.org", { lookup: async () => [] }),
      refusedWith("DNS_FAILED"),
    );
  });

  it("resolves again on every call: a changed answer is judged anew (DNS rebinding)", async () => {
    const answers = [["93.184.216.34"], ["127.0.0.1"]];
    let call = 0;
    const lookup: LookupFn = async () => lookupTo(...answers[call++])("");

    assert.equal((await resolveSafeAddresses("rebind.example.org", { lookup })).length, 1);
    await assert.rejects(
      resolveSafeAddresses("rebind.example.org", { lookup }),
      refusedWith("BLOCKED_ADDRESS"),
    );
  });
});

describe("createSafeFetch against a local server", () => {
  interface Seen {
    method: string;
    url: string;
    headers: IncomingHttpHeaders;
  }

  let server: http.Server;
  let port = 0;
  const seen: Seen[] = [];

  /** media.test / other.test -> loopback, the only place the test server listens. */
  const hosts: Record<string, string> = {
    "media.test": "127.0.0.1",
    "other.test": "127.0.0.1",
  };
  let lookups: string[] = [];
  const lookup: LookupFn = async (host) => {
    lookups.push(host);

    const address = hosts[host];

    if (!address) {
      throw new Error("ENOTFOUND");
    }

    return [{ address, family: 4 }];
  };

  const privateFetch = () => createSafeFetch({ allowPrivateNetwork: true, lookup });
  const base = () => `http://media.test:${port}`;

  before(async () => {
    server = http.createServer((request, response) => {
      const url = request.url ?? "/";

      seen.push({ method: request.method ?? "", url, headers: request.headers });

      switch (url) {
        case "/ok":
          response.writeHead(200, { "content-type": "video/mp4", etag: '"e1"' });
          response.end(request.method === "HEAD" ? undefined : "hello-media");
          return;
        case "/range": {
          const range = request.headers.range;

          if (range) {
            response.writeHead(206, {
              "content-type": "video/mp4",
              "content-range": "bytes 0-1/11",
              "content-length": "2",
            });
            response.end("he");
          } else {
            response.writeHead(200, { "content-type": "video/mp4" });
            response.end("hello-media");
          }

          return;
        }
        case "/redirect-same":
          response.writeHead(302, { location: "/ok" });
          response.end();
          return;
        case "/redirect-cross":
          response.writeHead(302, { location: `http://other.test:${port}/final` });
          response.end();
          return;
        case "/redirect-file":
          response.writeHead(302, { location: "file:///etc/passwd" });
          response.end();
          return;
        case "/redirect-bad":
          response.writeHead(302, { location: "http://[bad" });
          response.end();
          return;
        case "/loop":
          response.writeHead(302, { location: "/loop" });
          response.end();
          return;
        case "/final":
          response.writeHead(200, { "content-type": "video/mp4" });
          response.end("final");
          return;
        case "/gzip": {
          const compressed = gzipSync("compressed-hello");

          response.writeHead(200, {
            "content-type": "text/plain",
            "content-encoding": "gzip",
            "content-length": String(compressed.length),
          });
          response.end(compressed);
          return;
        }
        case "/zstd":
          response.writeHead(200, { "content-encoding": "zstd" });
          response.end("whatever");
          return;
        case "/slow":
          // Never answers: the client has to give up on its own.
          return;
        default:
          response.writeHead(404);
          response.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    seen.length = 0;
    lookups = [];
  });

  it("connects to the validated IP, keeps the Host header and resolves exactly once", async () => {
    const response = await privateFetch()(`${base()}/ok`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.equal(await response.text(), "hello-media");
    assert.deepEqual(lookups, ["media.test"]);
    assert.equal(seen[0].headers.host, `media.test:${port}`);
    assert.equal(seen[0].method, "GET");
  });

  it("does not re-resolve to a different address: the first validated answer is used", async () => {
    const answers = ["127.0.0.1", "10.255.255.1"];
    let call = 0;
    const flipping: LookupFn = async () => [{ address: answers[call++], family: 4 }];
    const response = await createSafeFetch({ allowPrivateNetwork: true, lookup: flipping })(
      `${base()}/ok`,
    );

    assert.equal(await response.text(), "hello-media");
    assert.equal(call, 1);
  });

  it("sends the caller's headers (Range, Authorization) and drops transport headers", async () => {
    const response = await privateFetch()(`${base()}/range`, {
      headers: {
        Range: "bytes=0-1",
        Authorization: "Bearer abc",
        Host: "evil.example.net",
        Connection: "upgrade",
        "Transfer-Encoding": "chunked",
      },
    });

    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), "bytes 0-1/11");
    assert.equal(await response.text(), "he");
    assert.equal(seen[0].headers.range, "bytes=0-1");
    assert.equal(seen[0].headers.authorization, "Bearer abc");
    assert.equal(seen[0].headers.host, `media.test:${port}`);
    assert.notEqual(seen[0].headers["transfer-encoding"], "chunked");
  });

  it("answers HEAD with headers and no body", async () => {
    const response = await privateFetch()(`${base()}/ok`, { method: "HEAD" });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("etag"), '"e1"');
    assert.equal(await response.text(), "");
    assert.equal(seen[0].method, "HEAD");
  });

  it("returns a redirect untouched in manual mode", async () => {
    const response = await privateFetch()(`${base()}/redirect-cross`, { redirect: "manual" });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `http://other.test:${port}/final`);
    assert.equal(seen.length, 1);
  });

  it("rejects a redirect in error mode", async () => {
    await assert.rejects(
      privateFetch()(`${base()}/redirect-same`, { redirect: "error" }),
      TypeError,
    );
  });

  it("follows a same-origin redirect and keeps the credentials", async () => {
    const response = await privateFetch()(`${base()}/redirect-same`, {
      headers: { Authorization: "Bearer abc" },
    });

    assert.equal(await response.text(), "hello-media");
    assert.equal(seen.length, 2);
    assert.equal(seen[1].url, "/ok");
    assert.equal(seen[1].headers.authorization, "Bearer abc");
  });

  it("re-validates a cross-origin redirect and strips credentials, keeping Range", async () => {
    const response = await privateFetch()(`${base()}/redirect-cross`, {
      headers: {
        Authorization: "Bearer abc",
        Cookie: "sid=1",
        "X-Api-Key": "k",
        Range: "bytes=0-9",
        "User-Agent": "unit-test",
      },
    });

    assert.equal(await response.text(), "final");
    assert.deepEqual(lookups, ["media.test", "other.test"]);

    const final = seen[1];

    assert.equal(final.url, "/final");
    assert.equal(final.headers.host, `other.test:${port}`);
    assert.equal(final.headers.authorization, undefined);
    assert.equal(final.headers.cookie, undefined);
    assert.equal(final.headers["x-api-key"], undefined);
    assert.equal(final.headers.range, "bytes=0-9");
    assert.equal(final.headers["user-agent"], "unit-test");
  });

  it("stops after 3 redirects", async () => {
    await assert.rejects(privateFetch()(`${base()}/loop`), refusedWith("TOO_MANY_REDIRECTS"));
    assert.equal(seen.length, 4);
  });

  it("refuses a redirect to a non-http scheme or an unparseable target", async () => {
    await assert.rejects(privateFetch()(`${base()}/redirect-file`), refusedWith("INVALID_URL"));
    await assert.rejects(privateFetch()(`${base()}/redirect-bad`), refusedWith("INVALID_URL"));
  });

  it("decodes gzip like fetch does and drops the stale length", async () => {
    const response = await privateFetch()(`${base()}/gzip`);

    assert.equal(response.headers.get("content-encoding"), null);
    assert.equal(response.headers.get("content-length"), null);
    assert.equal(await response.text(), "compressed-hello");
  });

  it("refuses a content-encoding it cannot decode", async () => {
    await assert.rejects(privateFetch()(`${base()}/zstd`), refusedWith("UNSUPPORTED"));
  });

  it("gives up when the signal aborts (client disconnected)", async () => {
    const controller = new AbortController();
    const pending = privateFetch()(`${base()}/slow`, { signal: controller.signal });

    setTimeout(() => controller.abort(), 50);

    await assert.rejects(pending);
  });

  it("does not even resolve the host when the signal is already aborted", async () => {
    await assert.rejects(privateFetch()(`${base()}/ok`, { signal: AbortSignal.abort() }));
    assert.deepEqual(lookups, []);
    assert.equal(seen.length, 0);
  });

  it("refuses request bodies", async () => {
    await assert.rejects(
      privateFetch()(`${base()}/ok`, { method: "POST", body: "x" }),
      refusedWith("UNSUPPORTED"),
    );
    assert.equal(seen.length, 0);
  });

  it("accepts URL objects as input", async () => {
    const response = await privateFetch()(new URL(`${base()}/ok`));

    assert.equal(await response.text(), "hello-media");
  });

  it("refuses URLs that are not plain http(s) without credentials", async () => {
    for (const url of ["ftp://media.test/x", "file:///etc/passwd", "https://u:p@media.test/x", "not a url", ""]) {
      await assert.rejects(privateFetch()(url), refusedWith("INVALID_URL"), url);
    }

    assert.equal(seen.length, 0);
  });

  describe("without allowPrivateNetwork (the default)", () => {
    const strict = () => createSafeFetch({ lookup });

    it("refuses a hostname that resolves to loopback, with a reason, and never connects", async () => {
      await assert.rejects(strict()(`${base()}/ok`), (error: unknown) => {
        return (
          error instanceof SafeFetchError &&
          error.code === "BLOCKED_ADDRESS" &&
          /privado ou reservado/.test(error.message) &&
          !error.message.includes("127.0.0.1")
        );
      });
      assert.equal(seen.length, 0);
    });

    it("refuses literal loopback, link-local, private and mapped addresses in every spelling", async () => {
      for (const host of [
        `127.0.0.1:${port}`,
        `[::1]:${port}`,
        `[::ffff:127.0.0.1]:${port}`,
        `[::ffff:7f00:1]:${port}`,
        `2130706433:${port}`,
        `0x7f.1:${port}`,
        `0177.0.0.1:${port}`,
        `0.0.0.0:${port}`,
        "169.254.169.254",
        "10.0.0.1",
        "192.168.0.1",
        "[fd00::1]",
        "[fe80::1]",
      ]) {
        await assert.rejects(
          strict()(`http://${host}/ok`),
          refusedWith("BLOCKED_ADDRESS"),
          host,
        );
      }

      assert.equal(seen.length, 0);
      assert.deepEqual(lookups, []);
    });

    it("refuses a host with one public and one private address", async () => {
      const mixed = createSafeFetch({ lookup: lookupTo("93.184.216.34", "127.0.0.1") });

      await assert.rejects(mixed(`http://mixed.test:${port}/ok`), refusedWith("BLOCKED_ADDRESS"));
      assert.equal(seen.length, 0);
    });

    it("reports a host that does not resolve", async () => {
      await assert.rejects(strict()("http://unknown.test/ok"), refusedWith("DNS_FAILED"));
    });
  });
});
