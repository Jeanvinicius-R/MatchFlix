import { auth } from "@/lib/auth";
import { handleProxyRequest, onStreamEnd } from "@/services/playback/proxy/proxy-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ token: string }>;
}

/** Simultaneous media streams per user (one per tab/player plus a few segments). */
const MAX_STREAMS_PER_USER = 12;

/** Per-process counter; good enough to stop one account from fanning out. */
const activeStreams = new Map<string, number>();

function acquireSlot(userId: string): boolean {
  const current = activeStreams.get(userId) ?? 0;

  if (current >= MAX_STREAMS_PER_USER) {
    return false;
  }

  activeStreams.set(userId, current + 1);
  return true;
}

function releaseSlot(userId: string): void {
  const current = activeStreams.get(userId) ?? 0;

  if (current <= 1) {
    activeStreams.delete(userId);
  } else {
    activeStreams.set(userId, current - 1);
  }
}

function plain(status: number, message: string, extra: Record<string, string> = {}) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

/**
 * Same-origin media proxy. The token (encrypted, per user, expiring) is the
 * only thing that says what to fetch; this route adds the session check and a
 * per-user stream limit, everything else lives in proxy-core.
 */
async function serve(request: Request, { params }: RouteContext) {
  const session = await auth();
  const viewerId = session?.user?.id;

  if (!viewerId) {
    return plain(401, "Acesso restrito.");
  }

  if (!acquireSlot(viewerId)) {
    return plain(429, "Muitas reproduções simultâneas.", { "Retry-After": "5" });
  }

  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      releaseSlot(viewerId);
    }
  };

  try {
    const { token } = await params;
    const result = await handleProxyRequest({
      method: request.method,
      token,
      rangeHeader: request.headers.get("range"),
      ifRangeHeader: request.headers.get("if-range"),
      viewerId,
      signal: request.signal,
    });

    if (result.body === null || typeof result.body === "string") {
      release();
      return new Response(result.body, { status: result.status, headers: result.headers });
    }

    // The slot is held until the stream ends, fails or the client goes away.
    return new Response(onStreamEnd(result.body, release), {
      status: result.status,
      headers: result.headers,
    });
  } catch (error) {
    release();
    // Never log the token or the error object: it could carry upstream details.
    console.error(
      "Erro no proxy de mídia:",
      error instanceof Error ? error.name : "erro desconhecido",
    );
    return plain(502, "Fonte de mídia indisponível.");
  }
}

export function GET(request: Request, context: RouteContext) {
  return serve(request, context);
}

export function HEAD(request: Request, context: RouteContext) {
  return serve(request, context);
}
