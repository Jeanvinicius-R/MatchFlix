import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { fileResponse } from "@/lib/http-range";
import { getMimeType, resolveExistingLibraryFile } from "@/lib/media-library";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

function decodeSegments(segments: string[]): string | null {
  try {
    return segments.map(decodeURIComponent).join("/");
  } catch {
    // Malformed escape (e.g. a lone "%"): not a file we could have listed.
    return null;
  }
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

  const relativePath = decodeSegments((await params).path);
  const file = relativePath ? await resolveExistingLibraryFile(relativePath) : null;
  const mimeType = relativePath ? getMimeType(relativePath) : null;
  if (!file || !mimeType) {
    return new NextResponse("Arquivo não encontrado.", { status: 404 });
  }

  return fileResponse(request, {
    absolutePath: file.absolutePath,
    sizeInBytes: file.sizeInBytes,
    mimeType,
    cacheControl: "private, max-age=3600",
    sendBody,
  });
}

export function GET(request: NextRequest, context: RouteContext) {
  return serve(request, context, true);
}

export function HEAD(request: NextRequest, context: RouteContext) {
  return serve(request, context, false);
}
