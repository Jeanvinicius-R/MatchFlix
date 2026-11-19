import type { Metadata } from "next";
import Link from "next/link";
import {
  CandidateFilters,
  type CandidateFilterValues,
  type CandidateMethodFilter,
} from "@/features/admin/components/CandidateFilters";
import { CandidateReviewTable } from "@/features/admin/components/CandidateReviewTable";
import type { CandidateAdapterOption } from "@/features/admin/components/CandidateShared";
import { CandidateSyncPanel } from "@/features/admin/components/CandidateSyncPanel";
import { requireAdmin } from "@/lib/require-admin";
import { listAdapters } from "@/services/playback-association.service";
import { listCandidates } from "@/services/playback-candidate.service";
import { BATCH_APPROVAL_MIN_SCORE } from "@/services/playback/candidate.service-core";

export const metadata: Metadata = {
  title: "Candidatos sugeridos — Painel administrativo",
};

/** Pending suggestions loaded per page view (highest scores first). */
const CANDIDATE_LIMIT = 300;

const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9-]{0,59}$/;

interface CandidatesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Unknown or malformed filters are ignored rather than failing the page. */
function parseFilters(
  params: Record<string, string | string[] | undefined>,
): CandidateFilterValues {
  const provider = firstValue(params.provider);
  const minScore = firstValue(params.minScore);
  const method = firstValue(params.method);

  return {
    provider: PROVIDER_PATTERN.test(provider) ? provider : "",
    minScore: /^\d{1,3}$/.test(minScore) && Number(minScore) <= 100 ? minScore : "",
    method: method === "strong" || method === "metadata" ? method : "",
  };
}

export default async function AdminCandidatesPage({ searchParams }: CandidatesPageProps) {
  // The layout guards too, but pages and actions are separate entry points.
  await requireAdmin();

  const filters = parseFilters(await searchParams);
  const adapters: CandidateAdapterOption[] = listAdapters().map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
    canDiscover: adapter.canDiscover,
    canListCatalog: adapter.canListCatalog,
    suggestedLicenseReference: adapter.suggestedLicenseReference,
  }));

  const loaded = await listCandidates({
    status: "PENDING",
    provider: filters.provider || undefined,
    minScore: filters.minScore ? Number(filters.minScore) : undefined,
    limit: CANDIDATE_LIMIT,
  });
  const candidates = filterByMethod(loaded, filters.method);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-foreground text-2xl font-semibold">
          Candidatos sugeridos
        </h1>
        <Link
          href="/admin/playback"
          className="text-accent hover:text-accent-strong text-sm underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Voltar para Reprodução
        </Link>
      </div>

      <div className="border-border bg-surface/60 text-muted-foreground flex flex-col gap-2 rounded-md border p-4 text-sm">
        <p>
          A sincronização com os provedores apenas <strong>sugere</strong> vínculos entre
          títulos do TMDB e vídeos do provedor. <strong>Nada fica disponível</strong> para
          os espectadores até você aprovar, informando a licença ou o contrato que cobre o
          vídeo.
        </p>
        <p>
          Correspondência, direitos e disponibilidade são verificações independentes: uma
          nota alta só indica que é o mesmo título e não comprova a autorização. Por
          isso a licença é sempre informada por você e registrada em cada aprovação.
        </p>
        <p>
          Correspondências por identificador (TMDB/IMDb) podem ser aprovadas em lote, de
          um provedor por vez, e só quando a licença informada abrange todos os títulos
          selecionados. Correspondências por título/ano podem ser homônimos: confira cada
          uma e aprove individualmente. Depois de aprovar, a disponibilidade real é
          conferida no provedor. Em caso de dúvida, rejeite.
        </p>
      </div>

      <CandidateSyncPanel adapters={adapters} />

      <section aria-labelledby="pending-heading" className="flex flex-col gap-4">
        <h2
          id="pending-heading"
          className="font-display text-foreground text-lg font-semibold"
        >
          Sugestões pendentes
        </h2>
        <CandidateFilters
          adapters={adapters}
          values={filters}
          action="/admin/playback/candidates"
        />
        <p className="text-muted-foreground text-xs">
          {candidates.length} sugestão(ões) exibida(s), da maior para a menor nota.
          {loaded.length >= CANDIDATE_LIMIT &&
            ` Mostrando só as ${CANDIDATE_LIMIT} primeiras; aprove ou rejeite para ver as seguintes.`}
        </p>
        <CandidateReviewTable
          candidates={candidates}
          adapters={adapters}
          batchMinScore={BATCH_APPROVAL_MIN_SCORE}
        />
      </section>
    </div>
  );
}

function filterByMethod<T extends { matchMethod: string }>(
  candidates: T[],
  method: CandidateMethodFilter,
): T[] {
  if (method === "strong") {
    return candidates.filter((candidate) => candidate.matchMethod !== "METADATA");
  }
  if (method === "metadata") {
    return candidates.filter((candidate) => candidate.matchMethod === "METADATA");
  }
  return candidates;
}
