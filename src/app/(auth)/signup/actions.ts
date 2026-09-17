"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { signUpSchema } from "@/schemas/auth.schemas";
import { EmailAlreadyInUseError, registerUser } from "@/services/user.service";

export interface SignUpFormState {
  formError?: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Called directly from the client form after react-hook-form/zod already
 * validated the input — re-validated here too, since client-side checks
 * are only a UX convenience and the server can never trust them.
 */
export async function signUpAction(input: unknown): Promise<SignUpFormState> {
  const parsedInput = signUpSchema.safeParse(input);

  if (!parsedInput.success) {
    return { fieldErrors: parsedInput.error.flatten().fieldErrors };
  }

  try {
    await registerUser(parsedInput.data);
  } catch (error) {
    if (error instanceof EmailAlreadyInUseError) {
      return { formError: error.message };
    }
    throw error;
  }

  try {
    await signIn("credentials", {
      email: parsedInput.data.email,
      password: parsedInput.data.password,
      redirectTo: "/profiles",
    });
  } catch (error) {
    // `signIn` throws Next.js's internal redirect signal on success — only
    // treat actual auth failures as errors, and let everything else through.
    if (error instanceof AuthError) {
      return { formError: "Conta criada. Faça login para continuar." };
    }
    throw error;
  }

  return {};
}
