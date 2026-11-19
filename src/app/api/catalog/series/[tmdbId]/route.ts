import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isTmdbNotFound, parseTmdbId } from "@/services/catalog-api";
import { getSeriesDetails } from "@/services/tmdb/tmdb.service";

interface RouteContext {
  params: Promise<{ tmdbId: string }>;
}

/** TMDB details of a series (with its season list): GET /api/catalog/series/[tmdbId] */
export async function GET(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 401 });
  }

  const tmdbId = parseTmdbId((await params).tmdbId);
  if (tmdbId === null) {
    return NextResponse.json({ error: "Id da TMDB inválido." }, { status: 400 });
  }

  try {
    return NextResponse.json({ details: await getSeriesDetails(tmdbId) });
  } catch (error) {
    if (isTmdbNotFound(error)) {
      return NextResponse.json({ error: "Série não encontrada." }, { status: 404 });
    }
    console.error("Erro ao consultar a série na TMDB:", error);
    return NextResponse.json({ error: "Não foi possível consultar a TMDB." }, { status: 500 });
  }
}
