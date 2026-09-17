import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export interface AdminSession {
  id: string;
  name: string;
}

/** Server Actions are directly POST-able, so this is the real security boundary — never rely on the layout guard alone. */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/");
  }
  return { id: session.user.id, name: session.user.name ?? "" };
}
