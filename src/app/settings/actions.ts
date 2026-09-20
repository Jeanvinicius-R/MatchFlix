"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth, unstable_update } from "@/lib/auth";
import {
  changePasswordSchema,
  updateEmailSchema,
  updateNameSchema,
} from "@/schemas/auth.schemas";
import {
  changeAccountPassword,
  EmailAlreadyInUseError,
  InvalidCurrentPasswordError,
  TooManyLoginAttemptsError,
  updateAccountEmail,
  updateAccountName,
  UserNotFoundError,
} from "@/services/user.service";

export interface SettingsActionState {
  formError?: string;
  fieldErrors?: Record<string, string[]>;
  success?: boolean;
}

/** The account being edited always comes from the session, never from the client. */
async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session.user.id;
}

/** Maps the expected domain errors to form feedback; anything else is a real bug and rethrows. */
function toFormState(error: unknown): SettingsActionState {
  if (error instanceof InvalidCurrentPasswordError) {
    return { fieldErrors: { currentPassword: [error.message] } };
  }
  if (error instanceof EmailAlreadyInUseError) {
    return { fieldErrors: { email: [error.message] } };
  }
  if (error instanceof TooManyLoginAttemptsError || error instanceof UserNotFoundError) {
    return { formError: error.message };
  }
  throw error;
}

export async function updateNameAction(input: unknown): Promise<SettingsActionState> {
  const userId = await requireUserId();
  const parsedInput = updateNameSchema.safeParse(input);
  if (!parsedInput.success) {
    return { fieldErrors: parsedInput.error.flatten().fieldErrors };
  }

  try {
    await updateAccountName(userId, parsedInput.data);
  } catch (error) {
    return toFormState(error);
  }

  await unstable_update({ user: { name: parsedInput.data.name } });
  revalidatePath("/", "layout");
  return { success: true };
}

export async function updateEmailAction(input: unknown): Promise<SettingsActionState> {
  const userId = await requireUserId();
  const parsedInput = updateEmailSchema.safeParse(input);
  if (!parsedInput.success) {
    return { fieldErrors: parsedInput.error.flatten().fieldErrors };
  }

  try {
    await updateAccountEmail(userId, parsedInput.data);
  } catch (error) {
    return toFormState(error);
  }

  await unstable_update({ user: { email: parsedInput.data.email } });
  revalidatePath("/", "layout");
  return { success: true };
}

export async function changePasswordAction(input: unknown): Promise<SettingsActionState> {
  const userId = await requireUserId();
  const parsedInput = changePasswordSchema.safeParse(input);
  if (!parsedInput.success) {
    return { fieldErrors: parsedInput.error.flatten().fieldErrors };
  }

  try {
    await changeAccountPassword(userId, parsedInput.data);
  } catch (error) {
    return toFormState(error);
  }

  return { success: true };
}
