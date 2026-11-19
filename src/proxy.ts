import { NextResponse } from "next/server";
import { buildFramePolicy } from "@/services/playback/frame-policy";

/**
 * Pages only: pins which origins the player may embed (CSP `frame-src`) and keeps
 * `frame-ancestors 'none'`. It runs per request because the embed origins come
 * from PLAYBACK_SERVERS, which next.config.ts could only read at build time.
 */
let cachedPolicy: string | undefined;

export function proxy() {
  cachedPolicy ??= buildFramePolicy();

  const response = NextResponse.next();

  response.headers.set("Content-Security-Policy", cachedPolicy);

  return response;
}

export const config = {
  // Not the API, static files or images.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
