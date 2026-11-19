import type { Metadata } from "next";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
import {
  describeAssociationAvailability,
  parseFreshHours,
} from "@/features/admin/components/CandidateShared";
import { PlaybackAssociationForm } from "@/features/admin/components/PlaybackAssociationForm";
import { PlaybackAssociationRow } from "@/features/admin/components/PlaybackAssociationRow";
import { PlaybackSeedButton } from "@/features/admin/components/PlaybackSeedButton";
import { SyncReverifyButton } from "@/features/admin/components/SyncReverifyButton";
import { requireAdmin } from "@/lib/require-admin";
import { listAdapters, listAssociations } from "@/services/playback-association.service";

export const metadata: Metadata = { title: "Reprodução — Painel administrativo" };

function describeSync(adapter: {
  canDiscover: boolean;
  canListCatalog: boolean;
}): string {
  if (adapter.canListCatalog) return "Sincronização: lista o catálogo do provedor.";
  if (adapter.canDiscover) return "Sincronização: pesquisa os títulos do catálogo local.";
  return "Sem sincronização (somente associação manual).";
}

/** Wall clock read outside the component body (keeps render purity lint quiet). */
function currentTimeMs(): number {
  return Date.now();
}

const TABLE_HEADERS = [
  "TMDB",
  "Tipo",
  "Provedor / vídeo",
  "Formato",
  "Direitos",
  "Disponibilidade",
  "Última verificação",
  "Licença",
  "Ações",
];

export default async function AdminPlaybackPage() {
  // The layout guards too, but pages and actions are separate entry points.
  await requireAdmin();

  const adapters = listAdapters();
  const associations = await listAssociations();
  const providerLabels = new Map(adapters.map((adapter) => [adapter.id, adapter.label]));
  const nowMs = currentTimeMs();
  const freshHours = parseFreshHours(process.env.PLAYBACK_AVAILABILITY_FRESH_HOURS);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-foreground text-2xl font-semibold">Reprodução</h1>

      <div className="border-border bg-surface/60 text-muted-foreground flex flex-col gap-2 rounded-md border p-4 text-sm">
        <p>
          O TMDB fornece apenas o catálogo (título, sinopse, imagens). O vídeo vem do
          provedor associado aqui, e somente de fontes autorizadas, licenciadas ou de
          domínio público.
        </p>
        <p>
          Um título sem associação <strong>verificada</strong> aparece como indisponível
          para os espectadores. Em caso de dúvida sobre os direitos, não marque como
          verificado.
        </p>
        <p>
          Direitos e disponibilidade são verificações independentes: uma associação só
          aparece como <strong>Confirmada</strong> quando os direitos estão verificados e
          o provedor entregou o vídeo numa checagem recente (padrão: 48 h). Sem checagem
          recente o estado é <strong>Desconhecida</strong>; se o provedor falhar, o
          estado é <strong>Indisponível</strong>. Só &quot;Confirmada&quot; conta como vídeo
          disponível nos cards.
        </p>
      </div>

      <div className="border-border flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
        <p className="text-muted-foreground text-sm">
          Sincronize os provedores para receber sugestões de vídeos e aprove-as com a
          licença que as cobre.
        </p>
        <Link
          href="/admin/playback/candidates"
          className={buttonStyles("secondary")}
        >
          Candidatos sugeridos
        </Link>
      </div>

      <section aria-labelledby="providers-heading" className="flex flex-col gap-3">
        <h2
          id="providers-heading"
          className="font-display text-foreground text-lg font-semibold"
        >
          Provedores e servidores
        </h2>
        <ul className="border-border divide-border divide-y rounded-md border text-sm">
          {adapters.map((adapter) => (
            <li key={adapter.id} className="flex flex-col gap-1 px-4 py-3">
              <p className="text-foreground font-medium">
                {adapter.label}{" "}
                <span className="text-muted-foreground text-xs font-normal">
                  ({adapter.id})
                </span>
              </p>
              <p className="text-muted-foreground text-xs">
                {describeSync(adapter)}
              </p>
              <p className="text-muted-foreground text-xs break-words">
                {adapter.suggestedLicenseReference
                  ? `Licença de acervo configurada (só serve para aprovar em lote o que ela realmente cobre): ${adapter.suggestedLicenseReference}`
                  : "Sem licença de acervo configurada (informe a licença a cada aprovação)."}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <SyncReverifyButton />

      <PlaybackSeedButton />

      <PlaybackAssociationForm adapters={adapters} />

      <section aria-labelledby="associations-heading" className="flex flex-col gap-3">
        <h2
          id="associations-heading"
          className="font-display text-foreground text-lg font-semibold"
        >
          Associações cadastradas
        </h2>
        {associations.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nenhuma associação cadastrada ainda.
          </p>
        ) : (
          <div className="border-border overflow-x-auto rounded-md border">
            <table className="text-foreground w-full text-left text-sm">
              <caption className="sr-only">
                Associações entre títulos do TMDB e vídeos de provedores, com status de
                direitos e disponibilidade
              </caption>
              <thead className="bg-surface/60 text-muted-foreground text-xs">
                <tr>
                  {TABLE_HEADERS.map((header) => (
                    <th key={header} scope="col" className="px-3 py-2 font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {associations.map((association) => (
                  <PlaybackAssociationRow
                    key={association.id}
                    association={association}
                    providerLabel={
                      providerLabels.get(association.provider) ?? association.provider
                    }
                    availability={describeAssociationAvailability(
                      association,
                      nowMs,
                      freshHours,
                    )}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
