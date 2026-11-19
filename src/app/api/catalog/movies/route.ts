import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { resolveKidsOnly } from "@/lib/api-browsing";
import { parsePage } from "@/services/catalog-api";
import { getMovieCatalogPage } from "@/services/content.service";

/** Local movie catalog, one page at a time: GET /api/catalog/movies?page=1 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 401 });
  }

  const page = parsePage(request.nextUrl.searchParams.get("page"));
  if (page === null) {
    return NextResponse.json({ error: "Parâmetro 'page' inválido." }, { status: 400 });
  }

  try {
    const kidsOnly = await resolveKidsOnly(session.user.id);
    return NextResponse.json(await getMovieCatalogPage(page, kidsOnly));
  } catch (error) {
    console.error("Erro ao listar o catálogo de filmes:", error);
    return NextResponse.json({ error: "Erro ao listar o catálogo" }, { status: 500 });
  }
}
