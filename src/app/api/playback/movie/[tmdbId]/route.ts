import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMoviePlaybackSources } from "@/services/playback";

interface RouteContext {
  params: Promise<{
    tmdbId: string;
  }>;
}

export async function GET(
  _request: Request,
  { params }: RouteContext
) {
  // Same rule as /api/library: playing content requires a signed-in user.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 401 });
  }

  try {
    const { tmdbId } = await params;
    const id = Number(tmdbId);

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        {
          error: "Parâmetros inválidos",
        },
        {
          status: 400,
        }
      );
    }

    const sources = await getMoviePlaybackSources(id);

    return NextResponse.json({
      tmdbId: id,
      sources,
    });
  } catch (error) {
    console.error(
      "Erro ao buscar playback do filme:",
      error
    );

    return NextResponse.json(
      {
        error: "Erro ao buscar fontes de reprodução",
      },
      {
        status: 500,
      }
    );
  }
}
