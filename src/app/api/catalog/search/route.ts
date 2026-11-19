import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { resolveKidsOnly } from "@/lib/api-browsing";
import { SEARCH_MIN_LENGTH, parseSearchTerm } from "@/services/catalog-api";
import { searchCatalog } from "@/services/content.service";

/** Searches the local catalog (movies and series): GET /api/catalog/search?q=... */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 401 });
  }

  const query = parseSearchTerm(request.nextUrl.searchParams.get("q"));
  if (query === null) {
    return NextResponse.json(
      { error: `Informe 'q' com ${SEARCH_MIN_LENGTH} a 100 caracteres.` },
      { status: 400 },
    );
  }

  try {
    const kidsOnly = await resolveKidsOnly(session.user.id);
    const items = await searchCatalog(query, kidsOnly);
    return NextResponse.json({ query, items });
  } catch (error) {
    console.error("Erro ao buscar no catálogo:", error);
    return NextResponse.json({ error: "Erro ao buscar no catálogo" }, { status: 500 });
  }
}
