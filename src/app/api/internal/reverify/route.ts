import { NextResponse, type NextRequest } from "next/server";
import { reverifyAssociations } from "@/services/playback-candidate.service";
import { isAuthorizedCronRequest } from "@/services/playback/cron-auth";

/** Associations checked per call; the scheduler keeps calling, oldest checks first. */
const REVERIFY_LIMIT = 25;

/**
 * Periodic re-check of VERIFIED associations (GitHub Actions
 * .github/workflows/playback-reverify.yml). No session: the caller proves
 * itself with `Authorization: Bearer <CRON_SECRET>`. Without CRON_SECRET the
 * endpoint does not exist. Associations flagged UNAVAILABLE are included so a
 * provider that came back recovers on its own.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret?.trim()) {
    return NextResponse.json({ error: "Reverificação desativada." }, { status: 404 });
  }

  if (!isAuthorizedCronRequest(request.headers.get("authorization"), secret)) {
    return NextResponse.json(
      { error: "Acesso restrito." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  try {
    const result = await reverifyAssociations({
      limit: REVERIFY_LIMIT,
      includeUnavailable: true,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro na reverificação periódica:", error);
    return NextResponse.json({ error: "Erro na reverificação" }, { status: 500 });
  }
}
