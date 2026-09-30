#!/usr/bin/env node
// Imprime a URL pública atual do túnel Cloudflare (serviço "cloudflared" do
// docker-compose). É um "quick tunnel" (sem conta/domínio) — a URL muda toda
// vez que o container é recriado, então este script lê sempre o log mais
// recente em vez de guardar a URL em algum lugar.
import { execSync } from "node:child_process";

const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/g;

function main() {
  let output;
  try {
    output = execSync("docker compose logs cloudflared", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    console.error("Não consegui ler os logs do serviço \"cloudflared\".");
    console.error("Ele está rodando? Tente: docker compose up -d cloudflared");
    console.error(error.message);
    process.exit(1);
  }

  const matches = [...output.matchAll(URL_PATTERN)];
  if (matches.length === 0) {
    console.error(
      "Nenhuma URL encontrada ainda nos logs — o túnel pode estar subindo. " +
        "Tente de novo em alguns segundos.",
    );
    process.exit(1);
  }

  // A última ocorrência é a URL da sessão atual do túnel.
  console.log(matches[matches.length - 1][0]);
}

main();
