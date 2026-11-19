// Prints the PLAYBACK_SERVERS value (and the env vars it references with "env:")
// for the e2e Next server, from the same e2e/e2e-config.json the mock server,
// the seed and the test use.
//
//   node e2e/servers-env.mjs            -> the JSON only
//   node e2e/servers-env.mjs --shell    -> `export NAME='value'` lines (use with eval)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "e2e-config.json"), "utf8"));
const { mock, licenseReference } = config;
const origin = `http://${mock.host}:${mock.port}`;

const xtream = {
  kind: "xtream",
  baseUrl: origin,
  username: "env:E2E_XTREAM_USER",
  password: "env:E2E_XTREAM_PASS",
  licenseReference,
};

const servers = [
  // Both mocks live on 127.0.0.1, so the operator opt-in is explicit.
  {
    ...xtream,
    id: "xtream-mock",
    label: "Xtream (mock E2E)",
    allowPrivateNetwork: true,
  },
  {
    id: "m3u-mock",
    label: "M3U + HLS (mock E2E)",
    kind: "m3u",
    playlistUrl: `${origin}/list.m3u?username=${mock.m3uUser}&password=${mock.m3uPass}`,
    licenseReference,
    allowPrivateNetwork: true,
  },
  // Same panel WITHOUT allowPrivateNetwork: the backend must refuse to connect.
  {
    ...xtream,
    id: "blocked-mock",
    label: "Servidor sem allowPrivateNetwork (mock E2E)",
  },
];

const json = JSON.stringify(servers);

function quote(value) {
  return `'${String(value).replace(/'/g, "'\''")}'`;
}

if (process.argv.includes("--shell")) {
  console.log(`export E2E_XTREAM_USER=${quote(mock.xtreamUser)}`);
  console.log(`export E2E_XTREAM_PASS=${quote(mock.xtreamPass)}`);
  console.log(`export PLAYBACK_SERVERS=${quote(json)}`);
} else {
  console.log(json);
}
