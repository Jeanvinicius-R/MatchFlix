import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isTmdbNotFound, parseTmdbId } from "@/services/catalog-api";
import { getMovieDetails } from "@/services/tmdb/tmdb.service";

interface RouteContext {
  params: Promise<{ tmdbId: string }>;
}

/** TMDB details of a movie, for any signed-in user: GET /api/catalog/movie/[tmdbId] */
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
    return NextResponse.json({ details: await getMovieDetails(tmdbId) });
  } catch (error) {
    if (isTmdbNotFound(error)) {
      return NextResponse.json({ error: "Filme não encontrado." }, { status: 404 });
    }
    console.error("Erro ao consultar o filme na TMDB:", error);
    return NextResponse.json({ error: "Não foi possível consultar a TMDB." }, { status: 500 });
  }
}
