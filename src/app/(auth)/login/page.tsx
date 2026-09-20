import Link from "next/link";
import type { Metadata } from "next";
import { LoginForm } from "@/features/auth/components/LoginForm";

export const metadata: Metadata = { title: "Entrar — MatchFlix" };

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-foreground text-center text-xl font-semibold">Entrar</h1>
      <LoginForm />
      <p className="text-muted-foreground text-center text-sm">
        Ainda não tem conta?{" "}
        <Link href="/signup" className="text-accent font-medium hover:underline">
          Criar conta
        </Link>
      </p>
    </div>
  );
}
