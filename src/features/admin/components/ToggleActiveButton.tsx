"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/Button";

interface ToggleActiveButtonProps {
  id: string;
  isActive: boolean;
  action: (id: string, nextIsActive: boolean) => Promise<void>;
}

export function ToggleActiveButton({ id, isActive, action }: ToggleActiveButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant={isActive ? "secondary" : "primary"}
      disabled={isPending}
      onClick={() => startTransition(() => action(id, !isActive))}
    >
      {isPending ? "Salvando..." : isActive ? "Desativar" : "Reativar"}
    </Button>
  );
}
