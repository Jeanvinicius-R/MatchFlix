import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isTmdbNotFound, parseSeasonNumber, parseTmdbId } from "@/services/catalog-api";
import { getSeasonDetails } from "@/services/tmdb/tmdb.service";

interface RouteContext {
  params: Promise<{ tmdbId: string; season: string }>;
}

/** Episodes of one season: GET /api/catalog/series/[tmdbId]/seasons/[season] (0 = specials) */
export async function GET(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 401 });
  }

  const { tmdbId: rawTmdbId, season: rawSeason } = await params;
  const tmdbId = parseTmdbId(rawTmdbId);
  const season = parseSeasonNumber(rawSeason);
  if (tmdbId === null || season === null) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }

  try {
    return NextResponse.json({ details: await getSeasonDetails(tmdbId, season) });
  } catch (error) {
    if (isTmdbNotFound(error)) {
      return NextResponse.json({ error: "Temporada não encontrada." }, { status: 404 });
    }
    console.error("Erro ao consultar a temporada na TMDB:", error);
    return NextResponse.json({ error: "Não foi possível consultar a TMDB." }, { status: 500 });
  }
}
