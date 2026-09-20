import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getVideoSourceProvider } from "@/services/video-sources";

/** Admin-only: searches a video source (e.g. Internet Archive) for titles. */
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

  const query = request.nextUrl.searchParams.get("query")?.trim();
  if (!query) {
    return NextResponse.json({ error: "Informe o parâmetro 'query'." }, { status: 400 });
  }

  try {
    return NextResponse.json({ results: await provider.search(query) });
  } catch {
    return NextResponse.json(
      { error: `Não foi possível consultar ${provider.label}.` },
      { status: 502 },
    );
  }
}
