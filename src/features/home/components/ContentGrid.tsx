import { ContentCard } from "@/features/home/components/ContentCard";
import type { ContentSummary } from "@/types/content.types";

interface ContentGridProps {
  items: ContentSummary[];
  emptyMessage: string;
}

export function ContentGrid({ items, emptyMessage }: ContentGridProps) {
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
  }

  return (
    <div className="flex flex-wrap gap-4 sm:gap-6">
      {items.map((content) => (
        <ContentCard key={content.id} content={content} />
      ))}
    </div>
  );
}
