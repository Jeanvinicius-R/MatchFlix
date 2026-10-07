"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { deleteProfileAction, updateProfileAction } from "@/app/profiles/actions";
import { Button } from "@/components/ui/Button";
import { FileUploadButton } from "@/components/ui/FileUploadButton";
import { Input } from "@/components/ui/Input";
import { ProfileAvatar } from "@/features/profiles/components/ProfileAvatar";
import { updateProfileSchema, type UpdateProfileInput } from "@/schemas/profile.schemas";
import type { ProfileSummary } from "@/types/profile.types";

interface EditProfileFormProps {
  profile: ProfileSummary;
  /** False for the account's only profile — it cannot be deleted. */
  canDelete: boolean;
}

export function EditProfileForm({ profile, canDelete }: EditProfileFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRemovingAvatar, setIsRemovingAvatar] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: profile.name, isKids: profile.isKids },
  });

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    // On success this redirects server-side and never returns a value here.
    const result = await updateProfileAction(profile.id, data);
    const firstFieldError = result.fieldErrors
      ? Object.values(result.fieldErrors)[0]?.[0]
      : undefined;
    setFormError(result.formError ?? firstFieldError ?? null);
  });

  async function handleDelete() {
    setIsDeleting(true);
    setFormError(null);
    const result = await deleteProfileAction(profile.id);
    setIsDeleting(false);
    setConfirmingDelete(false);
    setFormError(result.formError ?? null);
  }

  async function handleRemoveAvatar() {
    setIsRemovingAvatar(true);
    const response = await fetch(`/api/profiles/${profile.id}/avatar`, { method: "DELETE" });
    setIsRemovingAvatar(false);
    if (response.ok) {
      router.refresh();
    } else {
      setFormError("Não foi possível remover a foto.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3">
        <ProfileAvatar name={profile.name} isKids={profile.isKids} imageUrl={profile.avatarUrl} />
        <div className="flex flex-wrap items-start justify-center gap-2">
          <FileUploadButton
            uploadUrl={`/api/profiles/${profile.id}/avatar`}
            accept="image/jpeg,image/png,image/webp"
            label={profile.avatarUrl ? "Trocar foto" : "Enviar foto"}
            successMessage="Foto atualizada."
            className="items-center"
          />
          {profile.avatarUrl && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleRemoveAvatar}
              disabled={isRemovingAvatar}
            >
              Remover foto
            </Button>
          )}
        </div>
        <p className="text-muted-foreground text-xs">JPEG, PNG ou WebP, até 2 MB.</p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Input
          label="Nome do perfil"
          type="text"
          autoComplete="off"
          error={errors.name?.message}
          {...register("name")}
        />

        <label className="text-foreground flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-accent border-border bg-tint/5 h-4 w-4 rounded"
            {...register("isKids")}
          />
          Perfil infantil — mostra apenas conteúdo livre para todos os públicos
        </label>

        {formError && (
          <p role="alert" className="text-danger text-sm">
            {formError}
          </p>
        )}

        <Button type="submit" disabled={isSubmitting} className="mt-2 w-full">
          {isSubmitting ? "Salvando..." : "Salvar"}
        </Button>
        <Link
          href="/profiles/manage"
          className="text-muted-foreground hover:text-foreground text-center text-sm transition-colors"
        >
          Cancelar
        </Link>
      </form>

      <div className="border-border flex flex-col gap-3 border-t pt-6">
        {!canDelete ? (
          <p className="text-muted-foreground text-xs">
            Este é o único perfil da conta e não pode ser excluído.
          </p>
        ) : confirmingDelete ? (
          <>
            <p className="text-foreground text-sm">
              Excluir «{profile.name}»? Histórico, progresso e Minha lista deste perfil serão
              apagados. Isso não pode ser desfeito.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="bg-danger flex-1 text-white hover:opacity-90"
              >
                {isDeleting ? "Excluindo..." : "Excluir perfil"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmingDelete(false)}
                disabled={isDeleting}
              >
                Cancelar
              </Button>
            </div>
          </>
        ) : (
          <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(true)}>
            Excluir perfil
          </Button>
        )}
      </div>
    </div>
  );
}
