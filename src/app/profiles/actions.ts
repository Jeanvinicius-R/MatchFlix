"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createProfileSchema, updateProfileSchema } from "@/schemas/profile.schemas";
import {
  editProfile,
  LastProfileError,
  ProfileLimitReachedError,
  ProfileNotOwnedError,
  registerProfile,
  removeProfile,
} from "@/services/profile.service";

export interface CreateProfileActionState {
  formError?: string;
  fieldErrors?: Record<string, string[]>;
}

export type ProfileActionState = CreateProfileActionState;

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

const profileIdSchema = z.uuid();

export async function updateProfileAction(
  profileId: unknown,
  input: unknown,
): Promise<ProfileActionState> {
  const userId = await requireUserId();
  const id = profileIdSchema.safeParse(profileId);
  const parsedInput = updateProfileSchema.safeParse(input);
  if (!id.success) {
    return { formError: "Perfil não encontrado." };
  }
  if (!parsedInput.success) {
    return { fieldErrors: parsedInput.error.flatten().fieldErrors };
  }

  try {
    await editProfile(userId, id.data, parsedInput.data);
  } catch (error) {
    if (error instanceof ProfileNotOwnedError) {
      return { formError: error.message };
    }
    throw error;
  }

  revalidatePath("/", "layout");
  redirect("/profiles/manage");
}

export async function deleteProfileAction(profileId: unknown): Promise<ProfileActionState> {
  const userId = await requireUserId();
  const id = profileIdSchema.safeParse(profileId);
  if (!id.success) {
    return { formError: "Perfil não encontrado." };
  }

  try {
    await removeProfile(userId, id.data);
  } catch (error) {
    if (error instanceof ProfileNotOwnedError || error instanceof LastProfileError) {
      return { formError: error.message };
    }
    throw error;
  }

  revalidatePath("/", "layout");
  redirect("/profiles/manage");
}
