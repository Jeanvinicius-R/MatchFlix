import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Header } from "@/components/layout/Header";
import {
  EmailForm,
  NameForm,
  PasswordForm,
} from "@/features/settings/components/AccountForms";
import { ThemeSelector } from "@/features/settings/components/ThemeSelector";
import { auth } from "@/lib/auth";
import { getAccount } from "@/services/user.service";

export const metadata: Metadata = { title: "Configurações — MatchFlix" };

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-border bg-surface/60 flex flex-col gap-5 rounded-xl border p-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">{title}</h2>
        {description && (
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const account = await getAccount(session.user.id);

  return (
    <>
      <Header />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-28 pb-16 sm:px-8 md:pt-24">
        <h1 className="font-display text-foreground text-2xl font-semibold sm:text-3xl">
          Configurações
        </h1>

        <SettingsSection title="Aparência" description="Escolha o tema do MatchFlix.">
          <ThemeSelector />
        </SettingsSection>

        <SettingsSection title="Dados pessoais">
          <NameForm currentName={account.name} />
        </SettingsSection>

        <SettingsSection
          title="E-mail"
          description="É com ele que você entra. Confirme com a sua senha atual."
        >
          <EmailForm currentEmail={account.email} />
        </SettingsSection>

        <SettingsSection title="Senha">
          <PasswordForm />
        </SettingsSection>

        {session.user.role === "ADMIN" && (
          <SettingsSection
            title="Administração"
            description="Cadastro de filmes, séries, gêneros e vídeos."
          >
            <Link
              href="/admin/movies"
              className="text-accent hover:text-accent-strong w-fit text-sm font-medium"
            >
              Abrir painel administrativo
            </Link>
          </SettingsSection>
        )}

        <SettingsSection
          title="Perfis"
          description="Cada perfil tem o próprio histórico e a própria lista."
        >
          <Link
            href="/profiles/new"
            className="text-accent hover:text-accent-strong w-fit text-sm font-medium"
          >
            Adicionar perfil
          </Link>
        </SettingsSection>
      </main>
    </>
  );
}
