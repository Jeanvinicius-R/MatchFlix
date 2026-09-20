import Link from "next/link";
import type { Metadata } from "next";
import { LoginForm } from "@/features/auth/components/LoginForm";
import { safeNextPath } from "@/lib/next-path";

export const metadata: Metadata = { title: "Entrar — MatchFlix" };

interface LoginPageProps {
  searchParams: Promise<{ next?: string | string[] }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const next = safeNextPath((await searchParams).next);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-foreground text-center text-xl font-semibold">Entrar</h1>
      <LoginForm next={next} />
      <p className="text-muted-foreground text-center text-sm">
        Ainda não tem conta?{" "}
        <Link href="/signup" className="text-accent font-medium hover:underline">
          Criar conta
        </Link>
      </p>
    </div>
  );
}
