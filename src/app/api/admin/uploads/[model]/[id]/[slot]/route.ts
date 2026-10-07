import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { toUploadRequest, uploadErrorResponse } from "@/lib/upload-request";
import { findEpisodeSeriesId } from "@/repositories/upload.repository";
import { uploadContentImage, uploadContentVideo } from "@/services/upload.service";

interface RouteContext {
  params: Promise<{ model: string; id: string; slot: string }>;
}

/** Every combination the panel uploads to; anything else is a 404. */
const paramsSchema = z.union([
  z.object({
    model: z.enum(["movie", "series"]),
    id: z.uuid(),
    slot: z.enum(["poster", "backdrop"]),
  }),
  z.object({ model: z.enum(["movie", "episode"]), id: z.uuid(), slot: z.literal("video") }),
]);

/**
 * Raw-body upload (`fetch(url, { method: "POST", body: file })`) of a poster,
 * backdrop or video into LOCAL storage. Admin only — checked here, since a
 * Route Handler is reachable directly.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Destino de upload inválido." }, { status: 404 });
  }
  const { model, id, slot } = parsed.data;

  try {
    if (slot === "video") {
      await uploadContentVideo(model, id, toUploadRequest(request));
    } else {
      await uploadContentImage(model, id, slot, toUploadRequest(request));
    }
  } catch (error) {
    return uploadErrorResponse(error);
  }

  if (model === "episode") {
    const seriesId = await findEpisodeSeriesId(id);
    if (seriesId) {
      revalidatePath(`/admin/series/${seriesId}/edit`);
    }
  } else {
    revalidatePath(`/admin/${model === "movie" ? "movies" : "series"}/${id}/edit`);
    revalidatePath("/");
  }
  return NextResponse.json({ saved: true });
}
