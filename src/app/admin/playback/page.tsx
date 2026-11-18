import type { Metadata } from "next";
import { PlaybackAssociationForm } from "@/features/admin/components/PlaybackAssociationForm";
import { PlaybackAssociationRow } from "@/features/admin/components/PlaybackAssociationRow";
import { PlaybackSeedButton } from "@/features/admin/components/PlaybackSeedButton";
import { requireAdmin } from "@/lib/require-admin";
import { listAdapters, listAssociations } from "@/services/playback-association.service";

export const metadata: Metadata = { title: "Reprodução — Painel administrativo" };

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
      </div>

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
