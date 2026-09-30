import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera .next/standalone com só o necessário para rodar em produção
  // (usado pelo Dockerfile — ver README "Docker").
  output: "standalone",
};

export default nextConfig;
