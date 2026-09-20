"use client";

import { Check, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toggleFavoriteAction } from "@/app/favorites/actions";
import { buttonStyles } from "@/components/ui/Button";

interface FavoriteButtonProps {
  kind: "movie" | "series";
  contentId: string;
  initialIsFavorite: boolean;
}

export function FavoriteButton({
  kind,
  contentId,
  initialIsFavorite,
}: FavoriteButtonProps) {
  const [isFavorite, setIsFavorite] = useState(initialIsFavorite);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await toggleFavoriteAction({ kind, contentId });
      if (result.isFavorite !== undefined) {
        setIsFavorite(result.isFavorite);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={isFavorite}
      className={buttonStyles("secondary")}
    >
      {isFavorite ? (
        <Check size={18} aria-hidden="true" />
      ) : (
        <Plus size={18} aria-hidden="true" />
      )}
      {isFavorite ? "Na minha lista" : "Minha lista"}
    </button>
  );
}
