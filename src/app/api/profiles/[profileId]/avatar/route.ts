import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { toUploadRequest, uploadErrorResponse } from "@/lib/upload-request";
import { removeProfileAvatar, uploadProfileAvatar } from "@/services/upload.service";

interface RouteContext {
  params: Promise<{ profileId: string }>;
}

/** The profile id comes from the URL, so ownership is always re-checked in the service. */
async function resolve(context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Acesso restrito." }, { status: 401 }) };
  }
  const profileId = z.uuid().safeParse((await context.params).profileId);
  if (!profileId.success) {
    return { error: NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 }) };
  }
  return { userId: session.user.id, profileId: profileId.data };
}

function revalidateProfiles() {
  revalidatePath("/profiles");
  revalidatePath("/profiles/manage");
}

export async function POST(request: Request, context: RouteContext) {
  const resolved = await resolve(context);
  if ("error" in resolved) {
    return resolved.error;
  }
  try {
    await uploadProfileAvatar(resolved.userId, resolved.profileId, toUploadRequest(request));
  } catch (error) {
    return uploadErrorResponse(error);
  }
  revalidateProfiles();
  return NextResponse.json({ saved: true });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const resolved = await resolve(context);
  if ("error" in resolved) {
    return resolved.error;
  }
  try {
    await removeProfileAvatar(resolved.userId, resolved.profileId);
  } catch (error) {
    return uploadErrorResponse(error);
  }
  revalidateProfiles();
  return NextResponse.json({ removed: true });
}
