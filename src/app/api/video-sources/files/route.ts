import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getVideoSourceProvider, orderFilesForEpisodes } from "@/services/video-sources";

/** Admin-only: lists the browser-playable files of one item on a video source. */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const provider = getVideoSourceProvider(
    request.nextUrl.searchParams.get("provider") ?? "",
  );
  if (!provider) {
    return NextResponse.json({ error: "Fonte de vídeo desconhecida." }, { status: 400 });
  }

  const itemId = request.nextUrl.searchParams.get("itemId")?.trim();
  if (!itemId) {
    return NextResponse.json({ error: "Informe o parâmetro 'itemId'." }, { status: 400 });
  }

  // "for=episodes" collapses duplicates and sorts by name so files map onto episodes in order.
  const forEpisodes = request.nextUrl.searchParams.get("for") === "episodes";

  try {
    const files = await provider.listFiles(itemId);
    return NextResponse.json({
      files: forEpisodes ? orderFilesForEpisodes(files) : files,
    });
  } catch {
    return NextResponse.json(
      { error: `Não foi possível consultar ${provider.label}.` },
      { status: 502 },
    );
  }
}
