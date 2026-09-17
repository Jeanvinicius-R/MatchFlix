import { Info, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ContentSummary } from "@/types/content.types";
import { formatContentMeta, getPlaceholderGradientClass } from "@/utils/content.utils";

interface HeroBannerProps {
  content: ContentSummary;
}

export function HeroBanner({ content }: HeroBannerProps) {
  return (
    <section
      aria-label={`Destaque: ${content.title}`}
      className={`relative flex min-h-[85vh] w-full items-end bg-gradient-to-br sm:min-h-[92vh] ${getPlaceholderGradientClass(
        content.id,
      )}`}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 80% 20%, rgba(212,175,106,0.16), transparent)",
        }}
        aria-hidden="true"
      />
      <div className="from-background via-background/70 pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t to-transparent" />

      <div className="relative mx-auto w-full max-w-[1600px] px-4 pb-16 sm:px-8 sm:pb-24">
        <div className="max-w-xl">
          <h1 className="font-display text-foreground text-4xl leading-tight font-semibold text-balance sm:text-6xl">
            {content.title}
          </h1>
          <p className="text-muted-foreground mt-4 text-sm sm:text-base">
            {formatContentMeta(content)}
          </p>
          <p className="text-foreground/90 mt-4 line-clamp-3 text-base sm:text-lg">
            {content.synopsis}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button variant="primary">
              <Play size={18} fill="currentColor" aria-hidden="true" />
              Assistir
            </Button>
            <Button variant="secondary">
              <Info size={18} aria-hidden="true" />
              Mais informações
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
