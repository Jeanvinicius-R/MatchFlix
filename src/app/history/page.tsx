import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { requireProfile } from "@/lib/require-profile";
import { getWatchHistory } from "@/services/history.service";

export const metadata: Metadata = { title: "Histórico — MatchFlix" };

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

export default async function HistoryPage() {
  const profile = await requireProfile("/history");
  const entries = await getWatchHistory(profile.id, profile.isKids);

  return (
    <>
      <Header />
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 pt-28 pb-16 sm:px-8 md:pt-24">
        <h1 className="font-display text-foreground text-2xl font-semibold sm:text-3xl">
          Histórico
        </h1>

        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nada por aqui ainda. O que este perfil assistir aparece nesta lista.
          </p>
        ) : (
          <ul className="border-border divide-tint/5 divide-y rounded-lg border">
            {entries.map((entry) => {
              const action = entry.completed
                ? "Assistir de novo"
                : entry.progressPercent
                  ? "Continuar"
                  : "Assistir";
              return (
                <li key={entry.key} className="flex items-center gap-4 p-3 sm:p-4">
                  {entry.posterUrl ? (
                    // TMDB CDN or /api/media URLs — no next/image remote config needed for a thumbnail.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.posterUrl}
                      alt=""
                      loading="lazy"
                      className="aspect-[2/3] w-12 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div
                      className="bg-tint/10 aspect-[2/3] w-12 shrink-0 rounded"
                      aria-hidden="true"
                    />
                  )}

                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="text-foreground truncate text-sm font-medium">
                      {entry.title}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">{entry.subtitle}</p>
                    <p className="text-muted-foreground text-xs">
                      <time dateTime={entry.lastWatchedAt.toISOString()}>
                        {dateFormatter.format(entry.lastWatchedAt)}
                      </time>
                      {entry.completed
                        ? " · assistido"
                        : entry.progressPercent !== null
                          ? ` · ${entry.progressPercent}% assistido`
                          : ""}
                    </p>
                    {entry.progressPercent !== null && !entry.completed && (
                      <div
                        className="bg-tint/10 h-1 w-full max-w-48 overflow-hidden rounded"
                        role="progressbar"
                        aria-label="Progresso"
                        aria-valuenow={entry.progressPercent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="bg-accent h-full"
                          style={{ width: `${entry.progressPercent}%` }}
                        />
                      </div>
                    )}
                  </div>

                  <Link
                    href={entry.href}
                    className="text-foreground bg-tint/10 hover:bg-tint/20 shrink-0 rounded px-3 py-2 text-xs font-medium transition-colors"
                  >
                    {action}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
