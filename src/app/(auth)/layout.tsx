import type { ReactNode } from "react";
import { Logo } from "@/components/layout/Logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-4 py-16">
      <div className="border-border bg-surface/60 w-full max-w-sm rounded-xl border p-8 backdrop-blur-lg">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        {children}
      </div>
    </main>
  );
}
