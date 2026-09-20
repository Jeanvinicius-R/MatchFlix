"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { createProfileAction } from "@/app/profiles/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { createProfileSchema, type CreateProfileInput } from "@/schemas/profile.schemas";

export function CreateProfileForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateProfileInput>({
    resolver: zodResolver(createProfileSchema),
    defaultValues: { name: "", isKids: false },
  });

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    // On success this redirects server-side and never returns a value here.
    const result = await createProfileAction(data);

    const firstFieldError = result.fieldErrors
      ? Object.values(result.fieldErrors)[0]?.[0]
      : undefined;
    setFormError(result.formError ?? firstFieldError ?? null);
  });

  return (
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
        {isSubmitting ? "Criando..." : "Criar perfil"}
      </Button>
    </form>
  );
}
