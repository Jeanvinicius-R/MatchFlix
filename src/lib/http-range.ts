import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

/** "bytes=START-END" | "bytes=START-" | "bytes=-SUFFIX" -> inclusive byte range, or null if unsatisfiable. */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
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

interface FileResponseOptions {
  absolutePath: string;
  sizeInBytes: number;
  mimeType: string;
  cacheControl: string;
  sendBody: boolean;
}

/**
 * Serves a file from disk with HTTP Range support, so a <video> can seek
 * without downloading everything first.
 */
export function fileResponse(
  request: Request,
  { absolutePath, sizeInBytes, mimeType, cacheControl, sendBody }: FileResponseOptions,
): Response {
  const headers: Record<string, string> = {
    "Content-Type": mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
  };

  const rangeHeader = request.headers.get("range");
  let status = 200;
  let start = 0;
  let end = sizeInBytes - 1;

  if (rangeHeader) {
    const range = parseRange(rangeHeader, sizeInBytes);
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${sizeInBytes}` },
      });
    }
    ({ start, end } = range);
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${sizeInBytes}`;
  }
  headers["Content-Length"] = String(end - start + 1);

  if (!sendBody || sizeInBytes === 0) {
    return new Response(null, { status, headers });
  }

  const stream = createReadStream(absolutePath, { start, end });
  // Closing the tab or seeking elsewhere aborts the request: stop reading the disk.
  request.signal.addEventListener("abort", () => stream.destroy());
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
}
