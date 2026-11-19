"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/require-admin";
import {
  approveCandidatesSchema,
  rejectSchema,
  syncSchema,
} from "@/schemas/playback-candidate.schemas";
import {
  LicenseReferenceRequiredError,
  UnknownProviderError,
} from "@/services/playback-association.service";
import {
  approveCandidates,
  rejectCandidates,
  reverifyAssociations,
  syncProvider,
} from "@/services/playback-candidate.service";
import type { SyncReport } from "@/services/playback/candidate.service-core";

export interface CandidateActionState {
  ok: boolean;
  /** Short, user-facing summary (success or failure) in Portuguese. */
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Per-item problems the service reported (shown as a short list). */
  details?: string[];
  /** Sync only: what the provider scan did. */
  report?: SyncReport;
}

const GENERIC_ERROR = "Não foi possível concluir a operação. Tente novamente.";

/** Backstop for one admin-triggered re-check (each asset can take a few seconds). */
const REVERIFY_BATCH_LIMIT = 25;

// A licence declared for a whole batch is a claim about EVERY selected title, so the
// admin must confirm it explicitly. The service enforces this too (defence in depth).
const approveSchema = approveCandidatesSchema.extend({
  licenseCoversAllSelected: z.boolean().optional(),
});

/** Domain errors carry Portuguese messages; anything else is logged and hidden. */
function toFailure(error: unknown): CandidateActionState {
  if (
    error instanceof UnknownProviderError ||
    error instanceof LicenseReferenceRequiredError
  ) {
    return { ok: false, message: error.message };
  }
  if (error instanceof z.ZodError) {
    return invalidInput(error);
  }
  // Only the error type: messages may carry provider URLs (and thus credentials).
  console.error(
    "[admin/playback/candidates] unexpected error",
    error instanceof Error ? error.name : typeof error,
  );
  return { ok: false, message: GENERIC_ERROR };
}

function invalidInput(error: z.ZodError): CandidateActionState {
  const flattened = z.flattenError(error);
  return {
    ok: false,
    message: flattened.formErrors[0] ?? "Confira os campos destacados.",
    fieldErrors: flattened.fieldErrors as Record<string, string[]>,
  };
}

function refreshPages() {
  revalidatePath("/admin/playback/candidates");
  revalidatePath("/admin/playback");
}

export async function syncProviderAction(input: unknown): Promise<CandidateActionState> {
  await requireAdmin();
  const parsedInput = syncSchema.safeParse(input);
  if (!parsedInput.success) {
    return invalidInput(parsedInput.error);
  }

  let report: SyncReport;
  try {
    // Only creates PENDING suggestions; nothing becomes playable here.
    report = await syncProvider(parsedInput.data);
  } catch (error) {
    return toFailure(error);
  }

  refreshPages();
  return {
    ok: true,
    message:
      report.created > 0
        ? "Sincronização concluída. As sugestões novas aguardam sua revisão."
        : "Sincronização concluída. Nenhuma sugestão nova.",
    report,
  };
}

export async function approveCandidatesAction(
  input: unknown,
): Promise<CandidateActionState> {
  await requireAdmin();
  const parsedInput = approveSchema.safeParse(input);
  if (!parsedInput.success) {
    return invalidInput(parsedInput.error);
  }

  const request = parsedInput.data;
  if (request.ids.length > 1 && request.licenseCoversAllSelected !== true) {
    return {
      ok: false,
      message: `Confirme que a licença/contrato abrange TODOS os ${request.ids.length} títulos selecionados.`,
      fieldErrors: {
        licenseCoversAllSelected: ["Confirmação obrigatória para aprovar em lote."],
      },
    };
  }

  let result: { approved: number; skipped: number; errors: string[] };
  try {
    // The service enforces the batch rules (identifier match, score, same provider,
    // single id + ack for weak matches) and re-checks availability after approving.
    result = await approveCandidates(request);
  } catch (error) {
    return toFailure(error);
  }

  refreshPages();

  const details = result.errors.length > 0 ? result.errors : undefined;
  if (result.approved === 0) {
    return {
      ok: false,
      message:
        result.skipped > 0
          ? `Nada foi aprovado: ${result.skipped} já tinha(m) associação.`
          : "Nada foi aprovado.",
      details,
    };
  }

  const skippedNote =
    result.skipped > 0
      ? ` ${result.skipped} já tinha(m) associação e foi(ram) ignorado(s).`
      : "";
  return {
    ok: result.errors.length === 0,
    // Approval records the licence; availability is checked separately afterwards.
    message: `${result.approved} candidato(s) aprovado(s) com a licença registrada. A disponibilidade real é conferida em seguida: veja o estado em Reprodução.${skippedNote}`,
    details,
  };
}

export async function rejectCandidatesAction(
  ids: unknown,
): Promise<CandidateActionState> {
  await requireAdmin();
  const parsedIds = rejectSchema.safeParse({ ids });
  if (!parsedIds.success) {
    return invalidInput(parsedIds.error);
  }

  let rejected: number;
  try {
    rejected = await rejectCandidates(parsedIds.data.ids);
  } catch (error) {
    return toFailure(error);
  }

  refreshPages();
  return { ok: true, message: `${rejected} candidato(s) rejeitado(s).` };
}

export async function reverifyAssociationsAction(): Promise<CandidateActionState> {
  await requireAdmin();

  let result: { checked: number; available: number; unavailable: number };
  try {
    result = await reverifyAssociations({ limit: REVERIFY_BATCH_LIMIT });
  } catch (error) {
    return toFailure(error);
  }

  refreshPages();
  if (result.checked === 0) {
    return { ok: true, message: "Nenhuma associação verificada para reverificar." };
  }
  return {
    ok: result.unavailable === 0,
    message: `${result.checked} associação(ões) reverificada(s): ${result.available} disponível(is), ${result.unavailable} indisponível(is).${result.checked >= REVERIFY_BATCH_LIMIT ? " Pode haver mais: rode de novo." : ""}`,
  };
}
