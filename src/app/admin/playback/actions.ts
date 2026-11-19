"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/require-admin";
import {
  createAssociationSchema,
  setRightsSchema,
} from "@/schemas/playback-association.schemas";
import {
  AssetIdDerivationError,
  AssociationAlreadyExistsError,
  AssociationNotFoundError,
  LicenseReferenceRequiredError,
  UnknownProviderError,
  createAssociation,
  removeAssociation,
  seedOpenFilmAssociations,
  setAssociationRights,
  verifyAssociation,
} from "@/services/playback-association.service";

export interface PlaybackActionState {
  ok: boolean;
  /** Short, user-facing summary (success or failure) in Portuguese. */
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

const associationIdSchema = z.uuid();

const GENERIC_ERROR = "Não foi possível concluir a operação. Tente novamente.";

/** Domain errors carry Portuguese messages; anything else is logged and hidden. */
function toFailure(error: unknown): PlaybackActionState {
  if (
    error instanceof AssociationAlreadyExistsError ||
    error instanceof UnknownProviderError ||
    error instanceof AssociationNotFoundError ||
    error instanceof AssetIdDerivationError ||
    error instanceof LicenseReferenceRequiredError
  ) {
    return { ok: false, message: error.message };
  }
  console.error("[admin/playback] unexpected error", error);
  return { ok: false, message: GENERIC_ERROR };
}

export async function createAssociationAction(
  input: unknown,
): Promise<PlaybackActionState> {
  await requireAdmin();
  const parsedInput = createAssociationSchema.safeParse(input);
  if (!parsedInput.success) {
    const flattened = z.flattenError(parsedInput.error);
    return {
      ok: false,
      // Cross-field refinements (season/episode vs. media type) land in formErrors.
      message: flattened.formErrors[0] ?? "Confira os campos destacados.",
      fieldErrors: flattened.fieldErrors as Record<string, string[]>,
    };
  }

  try {
    // The service always stores new associations as UNVERIFIED.
    await createAssociation(parsedInput.data);
  } catch (error) {
    return toFailure(error);
  }

  revalidatePath("/admin/playback");
  return {
    ok: true,
    message: "Associação cadastrada como não verificada. Verifique os direitos antes de liberar.",
  };
}

export async function setAssociationRightsAction(
  input: unknown,
): Promise<PlaybackActionState> {
  await requireAdmin();
  const parsedInput = setRightsSchema.safeParse(input);
  if (!parsedInput.success) {
    return {
      ok: false,
      message: "Confira os campos destacados.",
      fieldErrors: z.flattenError(parsedInput.error).fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  try {
    await setAssociationRights(parsedInput.data);
  } catch (error) {
    return toFailure(error);
  }

  revalidatePath("/admin/playback");
  return { ok: true, message: "Direitos atualizados." };
}

export async function verifyAssociationAction(
  id: unknown,
): Promise<PlaybackActionState> {
  await requireAdmin();
  const parsedId = associationIdSchema.safeParse(id);
  if (!parsedId.success) {
    return { ok: false, message: "Identificador de associação inválido." };
  }

  let result;
  try {
    result = await verifyAssociation(parsedId.data);
  } catch (error) {
    return toFailure(error);
  }

  revalidatePath("/admin/playback");
  if (result.availabilityStatus === "AVAILABLE") {
    return { ok: true, message: "Vídeo disponível no provedor." };
  }
  if (result.availabilityStatus === "UNKNOWN") {
    return {
      ok: true,
      message: `Player acessível, mas a existência do vídeo não pôde ser confirmada. ${result.reason ?? ""}`.trim(),
    };
  }
  return {
    ok: false,
    message: result.reason
      ? `Vídeo indisponível no provedor: ${result.reason}`
      : "Vídeo indisponível no provedor.",
  };
}

export async function removeAssociationAction(
  id: unknown,
): Promise<PlaybackActionState> {
  await requireAdmin();
  const parsedId = associationIdSchema.safeParse(id);
  if (!parsedId.success) {
    return { ok: false, message: "Identificador de associação inválido." };
  }

  try {
    await removeAssociation(parsedId.data);
  } catch (error) {
    return toFailure(error);
  }

  revalidatePath("/admin/playback");
  return { ok: true, message: "Associação removida." };
}

export async function seedOpenFilmsAction(): Promise<PlaybackActionState> {
  await requireAdmin();

  let result;
  try {
    result = await seedOpenFilmAssociations();
  } catch (error) {
    return toFailure(error);
  }

  revalidatePath("/admin/playback");
  return {
    ok: true,
    message: `${result.created} filme(s) de teste adicionado(s), ${result.skipped} já existia(m).`,
  };
}
