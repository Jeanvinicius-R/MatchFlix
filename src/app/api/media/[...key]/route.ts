import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fileResponse } from "@/lib/http-range";
import { mimeTypeForKey, statStoredFile } from "@/lib/storage/local-storage";

interface RouteContext {
  params: Promise<{ key: string[] }>;
}

/**
 * Serves files from LOCAL storage. Posters/backdrops ("images/") are public
 * like the catalog itself; videos and avatars need a signed-in user. Keys are
 * validated against the exact shape the storage module generates, so nothing
 * outside the upload folder can ever be reached.
 */
async function serve(request: Request, { params }: RouteContext, sendBody: boolean) {
  const key = (await params).key.join("/");
  const isPublic = key.startsWith("images/");

  if (!isPublic) {
    const session = await auth();
    if (!session?.user) {
      return new NextResponse("Acesso restrito.", { status: 401 });
    }
  }

  const file = await statStoredFile(key);
  const mimeType = mimeTypeForKey(key);
  if (!file || !mimeType) {
    return new NextResponse("Arquivo não encontrado.", { status: 404 });
  }

  return fileResponse(request, {
    ...file,
    mimeType,
    // Keys are never reused (a new upload gets a new UUID), so caching is safe.
    cacheControl: isPublic ? "public, max-age=31536000, immutable" : "private, max-age=3600",
    sendBody,
  });
}

export function GET(request: Request, context: RouteContext) {
  return serve(request, context, true);
}

export function HEAD(request: Request, context: RouteContext) {
  return serve(request, context, false);
}
