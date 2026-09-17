import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { ProfileNotOwnedError, selectProfile } from "@/services/profile.service";

interface RouteContext {
  params: Promise<{ profileId: string }>;
}

/**
 * Sets the active-profile cookie and redirects home. A GET route (not a
 * Server Action) on purpose — cookies can only be written from a Server
 * Action or a Route Handler, never during a page's render, and this needs
 * to run both from a plain link click and from a server-side redirect
 * (the "only one profile" auto-select in /profiles).
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { profileId } = await params;

  try {
    await selectProfile(session.user.id, profileId);
  } catch (error) {
    if (error instanceof ProfileNotOwnedError) {
      return NextResponse.redirect(new URL("/profiles", request.url));
    }
    throw error;
  }

  return NextResponse.redirect(new URL("/", request.url));
}
