"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  changePasswordAction,
  updateEmailAction,
  updateNameAction,
  type SettingsActionState,
} from "@/app/settings/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  changePasswordSchema,
  updateEmailSchema,
  updateNameSchema,
  type ChangePasswordInput,
  type UpdateEmailInput,
  type UpdateNameInput,
} from "@/schemas/auth.schemas";

/** Copies server-side field errors onto the form and returns whether the save succeeded. */
function applyResult(
  result: SettingsActionState,
  setFieldError: (field: string, message: string) => void,
  setFormError: (message: string | null) => void,
): boolean {
  if (result.fieldErrors) {
    for (const [field, messages] of Object.entries(result.fieldErrors)) {
      if (messages?.[0]) {
        setFieldError(field, messages[0]);
      }
    }
    return false;
  }
  if (result.formError) {
    setFormError(result.formError);
    return false;
  }
  return true;
}

function FormFeedback({
  formError,
  saved,
}: {
  formError: string | null;
  saved: boolean;
}) {
  return (
    <>
      {formError && (
        <p role="alert" className="text-danger text-sm">
          {formError}
        </p>
      )}
      {saved && (
        <p role="status" className="text-accent text-sm">
          Alterações salvas.
        </p>
      )}
    </>
  );
}

export function NameForm({ currentName }: { currentName: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UpdateNameInput>({
    resolver: zodResolver(updateNameSchema),
    defaultValues: { name: currentName },
  });

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    setSaved(false);
    const result = await updateNameAction(data);
    const failed = !applyResult(
      result,
      (field, message) => setError(field as keyof UpdateNameInput, { message }),
      setFormError,
    );
    if (!failed) {
      setSaved(true);
      router.refresh();
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Input
        label="Nome"
        type="text"
        autoComplete="name"
        error={errors.name?.message}
        {...register("name")}
      />
      <FormFeedback formError={formError} saved={saved} />
      <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
        {isSubmitting ? "Salvando..." : "Salvar nome"}
      </Button>
    </form>
  );
}

export function EmailForm({ currentEmail }: { currentEmail: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<UpdateEmailInput>({
    resolver: zodResolver(updateEmailSchema),
    defaultValues: { email: currentEmail, currentPassword: "" },
  });

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    setSaved(false);
    const result = await updateEmailAction(data);
    const failed = !applyResult(
      result,
      (field, message) => setError(field as keyof UpdateEmailInput, { message }),
      setFormError,
    );
    if (!failed) {
      resetField("currentPassword");
      setSaved(true);
      router.refresh();
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Input
        label="E-mail"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <Input
        label="Senha atual (para confirmar)"
        type="password"
        autoComplete="current-password"
        error={errors.currentPassword?.message}
        {...register("currentPassword")}
      />
      <FormFeedback formError={formError} saved={saved} />
      <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
        {isSubmitting ? "Salvando..." : "Salvar e-mail"}
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmNewPassword: "" },
  });

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    setSaved(false);
    const result = await changePasswordAction(data);
    const failed = !applyResult(
      result,
      (field, message) => setError(field as keyof ChangePasswordInput, { message }),
      setFormError,
    );
    if (!failed) {
      reset();
      setSaved(true);
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Input
        label="Senha atual"
        type="password"
        autoComplete="current-password"
        error={errors.currentPassword?.message}
        {...register("currentPassword")}
      />
      <Input
        label="Nova senha"
        type="password"
        autoComplete="new-password"
        error={errors.newPassword?.message}
        {...register("newPassword")}
      />
      <Input
        label="Confirmar nova senha"
        type="password"
        autoComplete="new-password"
        error={errors.confirmNewPassword?.message}
        {...register("confirmNewPassword")}
      />
      <FormFeedback formError={formError} saved={saved} />
      <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
        {isSubmitting ? "Salvando..." : "Alterar senha"}
      </Button>
    </form>
  );
}
