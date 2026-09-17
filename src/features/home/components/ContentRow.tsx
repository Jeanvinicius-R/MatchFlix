import { ContentCard } from "@/features/home/components/ContentCard";
import type { ContentRow as ContentRowData } from "@/types/content.types";

interface ContentRowProps {
  row: ContentRowData;
}

export function ContentRow({ row }: ContentRowProps) {
  return (
    <section aria-labelledby={row.id} className="flex flex-col gap-3">
      <h2 id={row.id} className="text-foreground text-lg font-semibold sm:text-xl">
        {row.title}
      </h2>
      <div className="-mx-4 flex scrollbar-none gap-4 overflow-x-auto px-4 pb-2 sm:-mx-8 sm:px-8">
        {row.items.map((content) => (
          <ContentCard key={content.id} content={content} />
        ))}
      </div>
    </section>
  );
}
