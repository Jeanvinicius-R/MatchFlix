import Link from "next/link";
import type { Metadata } from "next";
import { SignUpForm } from "@/features/auth/components/SignUpForm";

export const metadata: Metadata = { title: "Criar conta — Aurel" };

export default function SignUpPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-foreground text-center text-xl font-semibold">Criar conta</h1>
      <SignUpForm />
      <p className="text-muted-foreground text-center text-sm">
        Já tem conta?{" "}
        <Link href="/login" className="text-accent font-medium hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}
