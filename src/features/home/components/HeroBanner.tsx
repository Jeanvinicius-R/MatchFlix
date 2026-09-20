import { Info, Play } from "lucide-react";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
import type { ContentSummary } from "@/types/content.types";
import { formatContentMeta, getPlaceholderGradientClass } from "@/utils/content.utils";

interface HeroBannerProps {
  content: ContentSummary;
}

export function HeroBanner({ content }: HeroBannerProps) {
  const watchHref =
    content.type === "MOVIE" ? `/watch/${content.slug}` : `/watch/series/${content.slug}`;

  return (
    <section
      aria-label={`Destaque: ${content.title}`}
      className={`relative flex min-h-[85vh] w-full items-end bg-gradient-to-br sm:min-h-[92vh] ${getPlaceholderGradientClass(
        content.id,
      )}`}
    >
      {content.backdropUrl ? (
        // Above the fold and the LCP element: load eagerly. TMDB serves this at banner size (w1280).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={content.backdropUrl}
          alt=""
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(60% 50% at 80% 20%, rgba(34,197,94,0.18), transparent)",
          }}
          aria-hidden="true"
        />
      )}
      {/* Véus escuros fixos: o texto do banner é sempre branco, em qualquer tema e sobre qualquer imagem. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/70 via-black/25 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/45 to-transparent" />
      {/* A transição para o fundo da página fica abaixo do texto. */}
      <div className="from-background pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t to-transparent" />

      <div className="relative mx-auto w-full max-w-[1600px] px-4 pb-28 sm:px-8 sm:pb-36">
        <div className="max-w-xl">
          <h1 className="font-display text-4xl leading-tight font-semibold text-balance text-white sm:text-6xl">
            {content.title}
          </h1>
          <p className="mt-4 text-sm text-white/70 sm:text-base">
            {formatContentMeta(content)}
          </p>
          <p className="mt-4 line-clamp-3 text-base text-white/90 sm:text-lg">
            {content.synopsis}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href={watchHref} className={buttonStyles("primary")}>
              <Play size={18} fill="currentColor" aria-hidden="true" />
              Assistir
            </Link>
            <Link
              href={watchHref}
              className={buttonStyles(
                "secondary",
                "bg-white/15 text-white hover:bg-white/25",
              )}
            >
              <Info size={18} aria-hidden="true" />
              Mais informações
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
