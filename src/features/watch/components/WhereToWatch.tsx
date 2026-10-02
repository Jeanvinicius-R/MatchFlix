import { getMovieWatchProviders, getSeriesWatchProviders } from "@/services/tmdb/tmdb.service";
import type { TmdbWatchProvider, TmdbWatchProviders } from "@/services/tmdb/tmdb.types";

interface WhereToWatchProps {
  tmdbId: number;
  kind: "movie" | "series";
}

/**
 * Category order and labels for the Brazilian catalog. Keys match the
 * `TmdbWatchProviders` fields one to one.
 */
const CATEGORIES: { key: keyof Omit<TmdbWatchProviders, "link">; label: string }[] = [
  { key: "flatrate", label: "Assinatura" },
  { key: "free", label: "Grátis" },
  { key: "ads", label: "Com anúncios" },
  { key: "rent", label: "Aluguel" },
  { key: "buy", label: "Compra" },
];

function ProviderBadge({ provider, href }: { provider: TmdbWatchProvider; href: string | null }) {
  const content = (
    <>
      {provider.logoUrl ? (
        // TMDB's own CDN, already sized (w92) for this — no need for next/image here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={provider.logoUrl}
          alt=""
          width={32}
          height={32}
          className="ring-tint/10 h-8 w-8 rounded-md object-cover ring-1"
        />
      ) : (
        <span className="bg-tint/10 h-8 w-8 rounded-md" aria-hidden="true" />
      )}
      <span className="text-foreground max-w-16 truncate text-center text-[11px]">
        {provider.name}
      </span>
    </>
  );

  // Every provider for a title/region shares the same TMDB aggregator link
  // (the API gives one link per country, not per provider) — never a
  // provider-specific URL we would have to guess or construct ourselves.
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col items-center gap-1.5 transition-opacity hover:opacity-80"
    >
      {content}
    </a>
  ) : (
    <div className="flex flex-col items-center gap-1.5">{content}</div>
  );
}

/**
 * "Onde assistir" — a showcase of legal streaming options from TMDB/JustWatch,
 * never a playback source. Renders nothing (not even an empty shell) when
 * there is no data for Brazil, or when the TMDB request fails.
 */
export async function WhereToWatch({ tmdbId, kind }: WhereToWatchProps) {
  let providers: TmdbWatchProviders;
  try {
    providers =
      kind === "movie"
        ? await getMovieWatchProviders(tmdbId)
        : await getSeriesWatchProviders(tmdbId);
  } catch (error) {
    console.error(`Erro ao buscar TMDB Watch Providers (tmdbId=${tmdbId}, kind=${kind}):`, error);
    return null;
  }

  const categories = CATEGORIES.map(({ key, label }) => ({
    label,
    items: providers[key],
  })).filter((category) => category.items.length > 0);

  if (categories.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-foreground text-lg font-semibold">Onde assistir</h2>
      {categories.map((category) => (
        <div key={category.label} className="flex flex-col gap-2">
          <h3 className="text-muted-foreground text-sm font-medium">{category.label}</h3>
          <div className="flex flex-wrap gap-4">
            {category.items.map((provider) => (
              <ProviderBadge key={provider.providerId} provider={provider} href={providers.link} />
            ))}
          </div>
        </div>
      ))}
      <p className="text-muted-foreground text-xs">
        Dados de disponibilidade de streaming fornecidos por JustWatch.
      </p>
    </section>
  );
}
