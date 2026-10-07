import type { NextConfig } from "next";

/**
 * Baseline security headers for every response. No full Content-Security-Policy:
 * the player embeds third-party iframes (YouTube, Internet Archive, the
 * authorized source) and loads the official YouTube IFrame API script, so
 * only `frame-ancestors` is pinned — nobody may frame MatchFlix itself.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // YouTube's embed needs the origin in the Referer; this keeps paths/queries private.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Gera .next/standalone com só o necessário para rodar em produção
  // (usado pelo Dockerfile — ver README "Docker").
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
