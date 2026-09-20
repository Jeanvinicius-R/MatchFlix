import Link from "next/link";
import { Clapperboard } from "lucide-react";
import type { ContentSummary } from "@/types/content.types";
import { formatContentMeta, getPlaceholderGradientClass } from "@/utils/content.utils";

interface ContentCardProps {
  content: ContentSummary;
}

export function ContentCard({ content }: ContentCardProps) {
  const hasPoster = Boolean(content.posterUrl);

  const card = (
    <article className="group w-40 shrink-0 sm:w-48">
      <div
        className={`relative aspect-[2/3] overflow-hidden rounded-lg bg-gradient-to-br ${getPlaceholderGradientClass(
          content.id,
        )} group-hover:ring-accent/40 ring-tint/5 ring-1 transition-transform duration-300 ease-out group-hover:-translate-y-1`}
      >
        {content.posterUrl ? (
          // TMDB's CDN already serves this at card size (w500); next/image would only add a proxy hop.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={content.posterUrl}
            alt={content.title}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/15">
            <Clapperboard size={40} aria-hidden="true" />
          </div>
        )}
        {/* Sem pôster o texto fica sempre visível; com pôster (que já traz o título) só ao passar o mouse. */}
        <div
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 pt-8 transition-opacity duration-200 ${
            hasPoster ? "opacity-0 group-hover:opacity-100" : ""
          }`}
        >
          <p className="line-clamp-2 text-sm font-medium text-white">{content.title}</p>
          <p className="mt-1 text-xs text-white/70">{formatContentMeta(content)}</p>
        </div>
      </div>
    </article>
  );

  const href =
    content.type === "MOVIE" ? `/watch/${content.slug}` : `/watch/series/${content.slug}`;

  return (
    <Link href={href} className="shrink-0">
      {card}
    </Link>
  );
}
