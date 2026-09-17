"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createProfileSchema } from "@/schemas/profile.schemas";
import { ProfileLimitReachedError, registerProfile } from "@/services/profile.service";

export interface CreateProfileActionState {
  formError?: string;
  fieldErrors?: Record<string, string[]>;
}

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session.user.id;
}

export async function createProfileAction(
  input: unknown,
): Promise<CreateProfileActionState> {
  const userId = await requireUserId();
  const parsedInput = createProfileSchema.safeParse(input);

  if (!parsedInput.success) {
    return { fieldErrors: parsedInput.error.flatten().fieldErrors };
  }

  try {
    await registerProfile(userId, parsedInput.data);
  } catch (error) {
    if (error instanceof ProfileLimitReachedError) {
      return { formError: error.message };
    }
    throw error;
  }

  redirect("/profiles");
}
