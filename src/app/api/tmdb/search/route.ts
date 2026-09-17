import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { searchMovies, searchSeries } from "@/services/tmdb/tmdb.service";

/**
 * Internal-only endpoint: lets the (future) admin panel search TMDB from a
 * client-side autocomplete without exposing the TMDB token to the browser.
 * Gated by role — nothing here is meant to be public.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const query = request.nextUrl.searchParams.get("query")?.trim();
  if (!query) {
    return NextResponse.json({ error: "Informe o parâmetro 'query'." }, { status: 400 });
  }

  const type = request.nextUrl.searchParams.get("type") === "series" ? "series" : "movie";

  try {
    const results =
      type === "series" ? await searchSeries(query) : await searchMovies(query);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível consultar a TMDB." },
      { status: 502 },
    );
  }
}
