// Creates a throw-away self-signed certificate for the HTTPS embed mock
// (e2e-out/tls/{key,cert}.pem, valid for 127.0.0.1). The Next server trusts it
// through NODE_EXTRA_CA_CERTS and Chrome through ignoreHTTPSErrors; nothing is
// ever trusted system-wide. Needs `openssl` on the PATH (Git for Windows ships it).
//
//   node e2e/make-tls.mjs            -> prints the cert path

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve("e2e-out", "tls");
const key = join(dir, "key.pem");
const cert = join(dir, "cert.pem");

if (!existsSync(cert) || !existsSync(key)) {
  mkdirSync(dir, { recursive: true });

  // OPENSSL_BIN lets a machine without openssl on the PATH (Windows) point at one.
  const result = spawnSync(
    process.env.OPENSSL_BIN || "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "3",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" },
  );

  if (result.status !== 0) {
    console.error(`openssl falhou: ${result.stderr ?? result.error?.message ?? "erro desconhecido"}`);
    process.exit(1);
  }
}

console.log(cert);
