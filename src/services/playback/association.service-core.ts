import {
  createAssociationSchema,
  type AssociationMediaTypeValue,
  type AvailabilityStatusValue,
  type CreateAssociationInput,
  type PlaybackFormatValue,
  type RightsStatusValue,
} from "../../schemas/playback-association.schemas";
import { isAdapterFailure, type PlaybackAdapter } from "./adapters/adapter.types";
import type { PlaybackSource } from "./playback.types";
import { describeSourceProblem } from "./source-guard";

/**
 * Testable core of the association service: every dependency is injected, so
 * tests run with an in-memory repository and fake adapters. The default
 * instance (Prisma + real adapters) is src/services/playback-association.service.ts.
 */

export interface AssociationView {
  id: string;
  tmdbId: number;
  mediaType: AssociationMediaTypeValue;
  seasonNumber: number;
  episodeNumber: number;
  provider: string;
  providerAssetId: string;
  playbackType: PlaybackFormatValue | null;
  rightsStatus: RightsStatusValue;
  licenseReference: string | null;
  availabilityStatus: AvailabilityStatusValue;
  lastVerifiedAt: Date | null;
  createdAt: Date;
}

export class AssociationAlreadyExistsError extends Error {
  constructor() {
    super("Esta associação já está cadastrada.");
    this.name = "AssociationAlreadyExistsError";
  }
}

export class UnknownProviderError extends Error {
  constructor(provider?: string) {
    super(
      provider
        ? `Provedor desconhecido: "${provider}".`
        : "Provedor desconhecido.",
    );
    this.name = "UnknownProviderError";
  }
}

export class AssociationNotFoundError extends Error {
  constructor() {
    super("Associação não encontrada.");
    this.name = "AssociationNotFoundError";
  }
}

export class LicenseReferenceRequiredError extends Error {
  constructor() {
    super("Informe a referência da licença para marcar como verificado.");
    this.name = "LicenseReferenceRequiredError";
  }
}

export interface NewAssociation {
  tmdbId: number;
  mediaType: AssociationMediaTypeValue;
  seasonNumber: number;
  episodeNumber: number;
  provider: string;
  providerAssetId: string;
  playbackType: PlaybackFormatValue | null;
  rightsStatus: RightsStatusValue;
  licenseReference: string | null;
}

export interface AssociationRepository {
  /** Most recent first. */
  list(): Promise<AssociationView[]>;
  findById(id: string): Promise<AssociationView | null>;
  /** Null when the (title, provider, asset) triple already exists. */
  create(data: NewAssociation): Promise<AssociationView | null>;
  /** `licenseReference: undefined` keeps the stored value. Null when not found. */
  updateRights(
    id: string,
    data: { rightsStatus: RightsStatusValue; licenseReference?: string | null },
  ): Promise<AssociationView | null>;
  updateAvailability(
    id: string,
    availabilityStatus: AvailabilityStatusValue,
    lastVerifiedAt: Date,
  ): Promise<void>;
  /** False when not found. */
  remove(id: string): Promise<boolean>;
}

export interface AssociationServiceDeps {
  repository: AssociationRepository;
  adapters: readonly PlaybackAdapter[];
  now?: () => Date;
  /** Admin-triggered checks may wait longer than a viewer's playback request. */
  verifyTimeoutMs?: number;
}

export interface VerifyResult {
  availabilityStatus: "AVAILABLE" | "UNAVAILABLE";
  reason?: string;
}

interface OpenFilm {
  tmdbId: number;
  assetId: string;
  title: string;
  licenseReference: string;
}

/**
 * Blender Foundation open movies, streamed from their Internet Archive items.
 * The licenses come from the official project pages (research on 2026-11-18):
 *   Big Buck Bunny  CC BY 3.0  peach.blender.org
 *   Sintel          CC BY 3.0  durian.blender.org
 *   Tears of Steel  CC BY 3.0  mango.blender.org
 *   Elephants Dream CC BY 2.5  orange.blender.org
 * Elephants Dream: the Archive item's own licenseurl says CC BY 3.0 (US) while the
 * official page says CC BY 2.5 — both are CC BY and pass the adapter's allowlist,
 * and the reference below cites the official page. Not covered by the film's
 * license: Tears of Steel's original score (CC BY-ND 3.0), Elephants Dream's extra
 * audio tracks (CC BY-NC-ND 2.5), logos and trademarks.
 * Seeding does not skip the technical gate: the Archive adapter still checks the
 * item's licenseurl every time it resolves, and "verify" records the outcome.
 */
export const OPEN_FILMS: readonly OpenFilm[] = [
  {
    tmdbId: 10378,
    assetId: "BigBuckBunny_124",
    title: "Big Buck Bunny",
    licenseReference: "CC BY 3.0 - Blender Foundation (peach.blender.org)",
  },
  {
    tmdbId: 45745,
    assetId: "Sintel",
    title: "Sintel",
    licenseReference: "CC BY 3.0 - Blender Foundation (durian.blender.org)",
  },
  {
    tmdbId: 133701,
    assetId: "Tears-of-Steel",
    title: "Tears of Steel",
    licenseReference: "CC BY 3.0 - Blender Foundation (mango.blender.org)",
  },
  {
    tmdbId: 9761,
    assetId: "ElephantsDream",
    title: "Elephants Dream",
    licenseReference:
      "CC BY 2.5 - Blender Foundation / Netherlands Media Art Institute (orange.blender.org)",
  },
];

/** Adapter id of the Internet Archive adapter. */
const OPEN_FILMS_PROVIDER = "archive";

const DEFAULT_VERIFY_TIMEOUT_MS = 8_000;

export function createAssociationService(deps: AssociationServiceDeps) {
  const { repository, adapters } = deps;
  const now = deps.now ?? (() => new Date());
  const verifyTimeoutMs = deps.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;

  function findAdapter(id: string): PlaybackAdapter | undefined {
    return adapters.find((adapter) => adapter.id === id);
  }

  /** Runs the adapter; any failure becomes a reason instead of an exception. */
  async function checkAsset(association: AssociationView): Promise<string | null> {
    const adapter = findAdapter(association.provider);

    if (!adapter) {
      return `Provedor desconhecido: "${association.provider}".`;
    }

    try {
      const result = await adapter.resolve(association.providerAssetId, {
        signal: AbortSignal.timeout(verifyTimeoutMs),
      });

      if (isAdapterFailure(result)) {
        return result.reason;
      }

      const source: PlaybackSource = {
        id: association.id,
        provider: adapter.id,
        type: result.type,
        url: result.url,
      };
      const problem = describeSourceProblem(source);

      return problem ? `Fonte recusada pela validação de URL: ${problem}.` : null;
    } catch {
      return "Falha ao consultar o provedor.";
    }
  }

  return {
    listAssociations(): Promise<AssociationView[]> {
      return repository.list();
    },

    /**
     * Always UNVERIFIED: authorizing the title is a separate, explicit decision
     * (setAssociationRights). Throws UnknownProviderError for an unregistered
     * provider and AssociationAlreadyExistsError for a duplicate.
     */
    async createAssociation(input: CreateAssociationInput): Promise<AssociationView> {
      const data = createAssociationSchema.parse(input);

      if (!findAdapter(data.provider)) {
        throw new UnknownProviderError(data.provider);
      }

      const created = await repository.create({
        tmdbId: data.tmdbId,
        mediaType: data.mediaType,
        seasonNumber: data.seasonNumber,
        episodeNumber: data.episodeNumber,
        provider: data.provider,
        providerAssetId: data.providerAssetId,
        playbackType: data.playbackType ?? null,
        rightsStatus: "UNVERIFIED",
        licenseReference: data.licenseReference ? data.licenseReference : null,
      });

      if (!created) {
        throw new AssociationAlreadyExistsError();
      }

      return created;
    },

    /**
     * An empty licenseReference clears it; undefined keeps the stored one. VERIFIED
     * needs a reference (given or stored): LicenseReferenceRequiredError otherwise.
     */
    async setAssociationRights(input: {
      id: string;
      rightsStatus: RightsStatusValue;
      licenseReference?: string;
    }): Promise<AssociationView> {
      const licenseReference =
        input.licenseReference === undefined
          ? undefined
          : input.licenseReference.trim() || null;

      if (input.rightsStatus === "VERIFIED") {
        let effective = licenseReference;

        if (effective === undefined) {
          const existing = await repository.findById(input.id);

          if (!existing) {
            throw new AssociationNotFoundError();
          }

          effective = existing.licenseReference;
        }

        if (!effective?.trim()) {
          throw new LicenseReferenceRequiredError();
        }
      }

      const updated = await repository.updateRights(input.id, {
        rightsStatus: input.rightsStatus,
        licenseReference,
      });

      if (!updated) {
        throw new AssociationNotFoundError();
      }

      return updated;
    },

    /**
     * Runs the adapter against the real provider and records AVAILABLE/UNAVAILABLE
     * plus the check time. A network failure is a result (UNAVAILABLE + reason),
     * never an exception. Throws only AssociationNotFoundError.
     */
    async verifyAssociation(id: string): Promise<VerifyResult> {
      const association = await repository.findById(id);

      if (!association) {
        throw new AssociationNotFoundError();
      }

      const reason = await checkAsset(association);

      if (reason !== null) {
        await repository.updateAvailability(id, "UNAVAILABLE", now());
        return { availabilityStatus: "UNAVAILABLE", reason };
      }

      await repository.updateAvailability(id, "AVAILABLE", now());
      return { availabilityStatus: "AVAILABLE" };
    },

    async removeAssociation(id: string): Promise<void> {
      if (!(await repository.remove(id))) {
        throw new AssociationNotFoundError();
      }
    },

    /**
     * Idempotent: an existing association (even one an admin later revoked) is
     * left alone and counted as skipped.
     */
    async seedOpenFilmAssociations(): Promise<{ created: number; skipped: number }> {
      if (!findAdapter(OPEN_FILMS_PROVIDER)) {
        throw new UnknownProviderError(OPEN_FILMS_PROVIDER);
      }

      let created = 0;
      let skipped = 0;

      for (const film of OPEN_FILMS) {
        const record = await repository.create({
          tmdbId: film.tmdbId,
          mediaType: "MOVIE",
          seasonNumber: 0,
          episodeNumber: 0,
          provider: OPEN_FILMS_PROVIDER,
          providerAssetId: film.assetId,
          playbackType: "MP4",
          rightsStatus: "VERIFIED",
          licenseReference: film.licenseReference,
        });

        if (record) {
          created += 1;
        } else {
          skipped += 1;
        }
      }

      return { created, skipped };
    },

    listAdapters(): { id: string; label: string; assetIdHint: string }[] {
      return adapters.map(({ id, label, assetIdHint }) => ({ id, label, assetIdHint }));
    },
  };
}

export type AssociationService = ReturnType<typeof createAssociationService>;
