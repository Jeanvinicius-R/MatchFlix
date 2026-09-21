import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getEpisodePlaybackSources } from "@/services/playback";

interface RouteContext {
  params: Promise<{
    tmdbId: string;
    season: string;
    episode: string;
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
    const {
      tmdbId,
      season,
      episode,
    } = await params;

    const id = Number(tmdbId);
    const seasonNumber = Number(season);
    const episodeNumber = Number(episode);

    if (
      !Number.isInteger(id) ||
      !Number.isInteger(seasonNumber) ||
      !Number.isInteger(episodeNumber) ||
      id <= 0 ||
      seasonNumber <= 0 ||
      episodeNumber <= 0
    ) {
      return NextResponse.json(
        {
          error: "Parâmetros inválidos",
        },
        {
          status: 400,
        }
      );
    }

    const sources = await getEpisodePlaybackSources(
      id,
      seasonNumber,
      episodeNumber
    );

    return NextResponse.json({
      tmdbId: id,
      season: seasonNumber,
      episode: episodeNumber,
      sources,
    });
  } catch (error) {
    console.error(
      "Erro ao buscar playback do episódio:",
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