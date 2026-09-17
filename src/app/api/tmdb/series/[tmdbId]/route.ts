import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSeriesDetails } from "@/services/tmdb/tmdb.service";

interface RouteContext {
  params: Promise<{ tmdbId: string }>;
}

/**
 * Internal-only endpoint: lets the admin panel prefill the series form from a
 * TMDB search result. Only fetches the series-level details (which already
 * include a season summary — number/title/episodeCount) for the prefill and
 * import preview; the actual episode-by-episode import happens server-side
 * inside createSeriesAction, not here.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const { tmdbId } = await params;
  const parsedId = Number(tmdbId);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return NextResponse.json({ error: "Id da TMDB inválido." }, { status: 400 });
  }

  try {
    const details = await getSeriesDetails(parsedId);
    return NextResponse.json({ details });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível consultar a TMDB." },
      { status: 502 },
    );
  }
}
