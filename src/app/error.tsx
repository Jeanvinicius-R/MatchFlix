"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-lg font-medium">Não foi possível carregar o conteúdo.</p>
      <Button variant="secondary" onClick={reset}>
        Tentar novamente
      </Button>
    </main>
  );
}
