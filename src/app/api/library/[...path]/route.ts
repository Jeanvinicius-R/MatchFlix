import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getMimeType, resolveExistingLibraryFile } from "@/lib/media-library";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

/** "bytes=START-END" | "bytes=START-" | "bytes=-SUFFIX" -> inclusive byte range, or null if unsatisfiable. */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) {
    return null;
  }
  let start: number;
  let end: number;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

/**
 * Streams a video from the user's own folder, with HTTP Range support so the
 * player can seek. Signed-in users only; the path is confined to the library.
 */
async function serve(request: NextRequest, { params }: RouteContext, sendBody: boolean) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Acesso restrito.", { status: 401 });
  }

  const { path: segments } = await params;
  const relativePath = segments.map(decodeURIComponent).join("/");
  const file = await resolveExistingLibraryFile(relativePath);
  const mimeType = getMimeType(relativePath);
  if (!file || !mimeType) {
    return new NextResponse("Arquivo não encontrado.", { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };

  const rangeHeader = request.headers.get("range");
  let status = 200;
  let start = 0;
  let end = file.sizeInBytes - 1;

  if (rangeHeader) {
    const range = parseRange(rangeHeader, file.sizeInBytes);
    if (!range) {
      return new NextResponse(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${file.sizeInBytes}` },
      });
    }
    ({ start, end } = range);
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${file.sizeInBytes}`;
  }
  headers["Content-Length"] = String(end - start + 1);

  if (!sendBody || file.sizeInBytes === 0) {
    return new NextResponse(null, { status, headers });
  }

  const stream = createReadStream(file.absolutePath, { start, end });
  // Closing the tab or seeking elsewhere aborts the request: stop reading the disk.
  request.signal.addEventListener("abort", () => stream.destroy());
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
}

export function GET(request: NextRequest, context: RouteContext) {
  return serve(request, context, true);
}

export function HEAD(request: NextRequest, context: RouteContext) {
  return serve(request, context, false);
}
