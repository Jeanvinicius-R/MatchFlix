import { Clapperboard } from "lucide-react";
import type { ContentSummary } from "@/types/content.types";
import { formatContentMeta, getPlaceholderGradientClass } from "@/utils/content.utils";

interface ContentCardProps {
  content: ContentSummary;
}

export function ContentCard({ content }: ContentCardProps) {
  return (
    <article className="group w-40 shrink-0 sm:w-48">
      <div
        className={`relative aspect-[2/3] overflow-hidden rounded-lg bg-gradient-to-br ${getPlaceholderGradientClass(
          content.id,
        )} group-hover:ring-accent/40 ring-1 ring-white/5 transition-transform duration-300 ease-out group-hover:-translate-y-1`}
      >
        <div className="absolute inset-0 flex items-center justify-center text-white/15">
          <Clapperboard size={40} aria-hidden="true" />
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 pt-8">
          <p className="text-foreground line-clamp-2 text-sm font-medium">
            {content.title}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {formatContentMeta(content)}
          </p>
        </div>
      </div>
    </article>
  );
}
