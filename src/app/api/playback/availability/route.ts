import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { titleAvailability } from "@/services/playback-availability.service";
import { parseAvailabilityQuery } from "@/services/playback/availability-query";

/**
 * Availability of one title: NONE / CONFIRMED / UNKNOWN / UNAVAILABLE, from
 * the stored association data (no network). With `check=1` the title's
 * VERIFIED associations are first re-checked at the provider (at most once a
 * minute per title), so the answer is real before anybody presses play.
 * Playback itself still re-resolves live — this only informs the UI.
 */
export async function GET(request: NextRequest) {
  // Same rule as the other /api/playback routes: signed-in users only.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 401 });
  }

  const parsed = parseAvailabilityQuery(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const availability = await titleAvailability.get(parsed.query, { live: parsed.live });
    return NextResponse.json(availability, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Erro ao consultar a disponibilidade:", error);
    return NextResponse.json(
      { error: "Erro ao consultar a disponibilidade" },
      { status: 500 },
    );
  }
}
