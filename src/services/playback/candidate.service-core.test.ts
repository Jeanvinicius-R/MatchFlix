import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AdapterFailure,
  CatalogPage,
  DiscoveryQuery,
  PlaybackAdapter,
  ProviderCandidate,
  ProviderCatalogItem,
} from "./adapters/adapter.types";
import {
  UnknownProviderError,
  type AssociationView,
  type NewAssociation,
  type VerifyResult,
} from "./association.service-core";
import {
  BATCH_APPROVAL_MIN_SCORE,
  createCandidateService,
  type AssociationPort,
  type CandidateFilter,
  type CandidateRepository,
  type CandidateView,
  type NewCandidate,
  type ScanTitle,
  type SyncLimits,
  type TmdbPort,
} from "./candidate.service-core";

const NOW = new Date("2026-11-19T12:00:00.000Z");
const LICENSE = "CC BY 3.0 - Blender Foundation (peach.blender.org)";

// ---- fakes ------------------------------------------------------------------

type Key = Pick<
  NewCandidate,
  | "tmdbId"
  | "mediaType"
  | "seasonNumber"
  | "episodeNumber"
  | "provider"
  | "providerAssetId"
>;

function keyOf(row: Key): string {
  return [
    row.tmdbId,
    row.mediaType,
    row.seasonNumber,
    row.episodeNumber,
    row.provider,
    row.providerAssetId,
  ].join("|");
}

function memoryRepository(options: { titles?: ScanTitle[]; associated?: Key[] } = {}) {
  const rows = new Map<string, CandidateView>();
  const associated = new Set((options.associated ?? []).map(keyOf));
  const scanCalls: { provider: string; limit: number }[] = [];
  let sequence = 0;

  function insert(data: NewCandidate, overrides: Partial<CandidateView> = {}): CandidateView {
    sequence += 1;

    const row: CandidateView = {
      ...data,
      id: `cand-${sequence}`,
      status: "PENDING",
      createdAt: new Date(1_700_000_000_000 + sequence * 1_000),
      decidedAt: null,
      ...overrides,
    };

    rows.set(row.id, row);
    return row;
  }

  const repository: CandidateRepository = {
    async saveSuggestion(data) {
      const key = keyOf(data);

      if (associated.has(key)) {
        return "existing";
      }

      const existing = [...rows.values()].find((row) => keyOf(row) === key);

      if (existing) {
        // Only a PENDING candidate is refreshed; a decided one is never reopened.
        if (existing.status === "PENDING") {
          rows.set(existing.id, { ...existing, score: data.score, reason: data.reason });
        }

        return "existing";
      }

      insert(data);
      return "created";
    },
    async list(filter: CandidateFilter) {
      return [...rows.values()]
        .filter(
          (row) =>
            (filter.status === undefined || row.status === filter.status) &&
            (filter.provider === undefined || row.provider === filter.provider) &&
            (filter.minScore === undefined || row.score >= filter.minScore) &&
            (filter.matchKind === undefined ||
              (filter.matchKind === "metadata") === (row.matchMethod === "METADATA")),
        )
        .sort(
          (a, b) => b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime(),
        )
        .slice(0, filter.limit ?? 200);
    },
    async findByIds(ids) {
      return ids.flatMap((id) => {
        const row = rows.get(id);
        return row ? [row] : [];
      });
    },
    async markDecided(ids, status, decidedAt) {
      let changed = 0;

      for (const id of ids) {
        const row = rows.get(id);

        if (row && row.status === "PENDING") {
          rows.set(id, { ...row, status, decidedAt });
          changed += 1;
        }
      }

      return changed;
    },
    async findTitlesToScan(input) {
      scanCalls.push(input);
      return (options.titles ?? []).slice(0, input.limit);
    },
    async knownAssetIds(provider) {
      const ids = new Set<string>();

      for (const key of associated) {
        const [, , , , keyProvider, assetId] = key.split("|");

        if (keyProvider === provider) {
          ids.add(assetId);
        }
      }

      for (const row of rows.values()) {
        if (row.provider === provider) {
          ids.add(row.providerAssetId);
        }
      }

      return ids;
    },
  };

  return { rows, repository, scanCalls, insert };
}

function fakeAssociations(
  options: {
    existing?: Key[];
    unavailable?: Set<string>;
    verifyThrows?: boolean;
    reverifyIds?: string[];
    /** Rights of the pre-existing associations (default VERIFIED). */
    existingRights?: NewAssociation["rightsStatus"];
  } = {},
) {
  const existing = new Set((options.existing ?? []).map(keyOf));
  const created: NewAssociation[] = [];
  const verified: string[] = [];
  const reverifyCalls: { limit: number; includeUnavailable: boolean }[] = [];

  const port: AssociationPort = {
    async create(data) {
      const key = keyOf(data);

      if (existing.has(key)) {
        return null;
      }

      existing.add(key);
      created.push(data);

      const view: AssociationView = {
        id: `assoc-${created.length}`,
        ...data,
        availabilityStatus: "UNKNOWN",
        lastVerifiedAt: null,
        createdAt: NOW,
      };

      return view;
    },
    async findRights(key) {
      return existing.has(keyOf(key)) ? (options.existingRights ?? "VERIFIED") : null;
    },
    async verify(id): Promise<VerifyResult> {
      verified.push(id);

      if (options.verifyThrows) {
        throw new Error("boom");
      }

      return options.unavailable?.has(id)
        ? { availabilityStatus: "UNAVAILABLE", reason: "fora do ar" }
        : { availabilityStatus: "AVAILABLE" };
    },
    async idsForReverification(request) {
      reverifyCalls.push(request);
      return options.reverifyIds ?? [];
    },
  };

  return { port, created, verified, reverifyCalls };
}

function fakeTmdb(overrides: Partial<TmdbPort> = {}) {
  const calls: string[] = [];
  const port: TmdbPort = {
    async getMovieExternalIds(tmdbId) {
      calls.push(`movie-ext:${tmdbId}`);
      return { imdbId: null };
    },
    async getSeriesExternalIds(tmdbId) {
      calls.push(`series-ext:${tmdbId}`);
      return { imdbId: null };
    },
    async findTmdbByImdbId(imdbId) {
      calls.push(`find:${imdbId}`);
      return {};
    },
    async searchMovies(query) {
      calls.push(`search-movie:${query}`);
      return [];
    },
    async searchSeries(query) {
      calls.push(`search-series:${query}`);
      return [];
    },
    ...overrides,
  };

  return { port, calls };
}

function adapterOf(id: string, extras: Partial<PlaybackAdapter> = {}): PlaybackAdapter {
  return {
    id,
    label: `Label ${id}`,
    assetIdHint: `hint ${id}`,
    resolve: async () => ({ reason: "not used here" }),
    ...extras,
  };
}

interface SetupOptions {
  adapters?: PlaybackAdapter[];
  titles?: ScanTitle[];
  associated?: Key[];
  associations?: Parameters<typeof fakeAssociations>[0];
  tmdb?: Partial<TmdbPort>;
  limits?: Partial<SyncLimits>;
  now?: () => Date;
}

function setup(options: SetupOptions = {}) {
  const memory = memoryRepository({ titles: options.titles, associated: options.associated });
  const associations = fakeAssociations(options.associations);
  const tmdb = fakeTmdb(options.tmdb);
  const service = createCandidateService({
    repository: memory.repository,
    associations: associations.port,
    adapters: options.adapters ?? [adapterOf("archive")],
    tmdb: tmdb.port,
    limits: options.limits,
    now: options.now ?? (() => NOW),
  });

  return { ...memory, associations, tmdb, service };
}

// ---- fixtures ------------------------------------------------------------------

const BBB_TITLE: ScanTitle = {
  tmdbId: 10378,
  mediaType: "MOVIE",
  seasonNumber: 0,
  episodeNumber: 0,
  title: "Big Buck Bunny",
  originalTitle: "Big Buck Bunny",
  year: 2008,
  runtimeMinutes: 10,
};

const GOT_EPISODE: ScanTitle = {
  tmdbId: 1399,
  mediaType: "EPISODE",
  seasonNumber: 2,
  episodeNumber: 5,
  title: "Game of Thrones",
  originalTitle: "Game of Thrones",
  year: 2011,
  runtimeMinutes: 55,
};

function candidateData(overrides: Partial<NewCandidate> = {}): NewCandidate {
  return {
    tmdbId: 10378,
    mediaType: "MOVIE",
    seasonNumber: 0,
    episodeNumber: 0,
    provider: "archive",
    providerAssetId: "BigBuckBunny_124",
    providerTitle: "Big Buck Bunny",
    providerYear: 2008,
    matchMethod: "TMDB_ID",
    score: 100,
    reason: "O provedor declara tmdb_id 10378.",
    ...overrides,
  };
}

function discoverAdapter(
  discover: (query: DiscoveryQuery) => Promise<ProviderCandidate[] | AdapterFailure>,
  id = "archive",
): PlaybackAdapter {
  return adapterOf(id, { discover: async (query) => discover(query) });
}

function catalogAdapter(
  pages: Record<string, CatalogPage | AdapterFailure>,
  id = "meu-servidor",
) {
  const requested: (string | undefined)[] = [];
  const adapter = adapterOf(id, {
    listCatalog: async (cursor) => {
      requested.push(cursor);
      return pages[cursor ?? "start"] ?? { items: [] };
    },
  });

  return { adapter, requested };
}

function movieItem(overrides: Partial<ProviderCatalogItem> = {}): ProviderCatalogItem {
  return {
    mediaType: "MOVIE",
    providerAssetId: "vod:1",
    title: "Big Buck Bunny",
    ...overrides,
  };
}

function episodeItem(overrides: Partial<ProviderCatalogItem> = {}): ProviderCatalogItem {
  return {
    mediaType: "EPISODE",
    providerAssetId: "series:1399:2:5",
    title: "The Kingsroad",
    seriesTitle: "Game of Thrones",
    seasonNumber: 2,
    episodeNumber: 5,
    ...overrides,
  };
}

// ---- sync: titles mode --------------------------------------------------------

describe("syncProvider (titles mode)", () => {
  it("stores PENDING suggestions and never creates an association", async () => {
    let received: DiscoveryQuery | undefined;
    const { service, rows, associations } = setup({
      adapters: [
        discoverAdapter(async (query) => {
          received = query;
          return [
            {
              providerAssetId: "BigBuckBunny_124",
              title: "Big Buck Bunny",
              year: 2008,
              durationMinutes: 10,
            },
          ];
        }),
      ],
      titles: [BBB_TITLE],
      tmdb: {
        getMovieExternalIds: async () => ({ imdbId: "tt1254207" }),
      },
    });
    const report = await service.syncProvider({ providerId: "archive" });

    assert.equal(report.mode, "titles");
    assert.equal(report.scanned, 1);
    assert.equal(report.created, 1);
    assert.equal(report.skippedExisting, 0);
    assert.deepEqual(report.failures, []);
    assert.equal(received?.imdbId, "tt1254207");
    assert.equal(received?.runtimeMinutes, 10);

    const [row] = [...rows.values()];

    assert.equal(row.status, "PENDING");
    assert.equal(row.matchMethod, "METADATA");
    assert.equal(row.score, 88);
    assert.equal(row.provider, "archive");
    assert.equal(row.providerAssetId, "BigBuckBunny_124");
    assert.equal(row.providerYear, 2008);
    assert.equal(associations.created.length, 0);
  });

  it("scores a declared tmdb id as a strong match", async () => {
    const { service, rows } = setup({
      adapters: [
        discoverAdapter(async () => [
          {
            providerAssetId: "abc",
            title: "Anything",
            externalIds: { tmdb: 10378 },
          },
        ]),
      ],
      titles: [BBB_TITLE],
    });

    await service.syncProvider({ providerId: "archive" });

    const [row] = [...rows.values()];

    assert.equal(row.matchMethod, "TMDB_ID");
    assert.equal(row.score, 100);
  });

  it("drops weak and conflicting candidates", async () => {
    const { service, rows } = setup({
      adapters: [
        discoverAdapter(async () => [
          { providerAssetId: "wrong-year", title: "Big Buck Bunny", year: 2012 },
          { providerAssetId: "other", title: "Big Buck Bunny", externalIds: { tmdb: 5 } },
          { providerAssetId: "no-year", title: "Big Buck Bunny" },
        ]),
      ],
      titles: [BBB_TITLE],
    });
    const report = await service.syncProvider({ providerId: "archive" });

    assert.equal(report.created, 0);
    assert.equal(rows.size, 0);
  });

  it("keeps going when TMDB fails (no imdb id in the query)", async () => {
    let received: DiscoveryQuery | undefined;
    const { service, rows } = setup({
      adapters: [
        discoverAdapter(async (query) => {
          received = query;
          return [{ providerAssetId: "a", title: "Big Buck Bunny", year: 2008 }];
        }),
      ],
      titles: [BBB_TITLE],
      tmdb: {
        getMovieExternalIds: async () => {
          throw new Error("TMDB down");
        },
      },
    });
    const report = await service.syncProvider({ providerId: "archive" });

    assert.equal(received?.imdbId, undefined);
    assert.equal(report.created, 1);
    assert.equal(rows.size, 1);
  });

  it("is idempotent: a second run only counts skippedExisting", async () => {
    const { service, rows } = setup({
      adapters: [
        discoverAdapter(async () => [
          { providerAssetId: "a", title: "Big Buck Bunny", year: 2008 },
        ]),
      ],
      titles: [BBB_TITLE],
    });

    await service.syncProvider({ providerId: "archive" });

    const second = await service.syncProvider({ providerId: "archive" });

    assert.equal(second.created, 0);
    assert.equal(second.skippedExisting, 1);
    assert.equal(rows.size, 1);
  });

  it("skips titles that already have an association", async () => {
    const { service, rows } = setup({
      adapters: [
        discoverAdapter(async () => [
          { providerAssetId: "a", title: "Big Buck Bunny", year: 2008 },
        ]),
      ],
      titles: [BBB_TITLE],
      associated: [
        {
          tmdbId: 10378,
          mediaType: "MOVIE",
          seasonNumber: 0,
          episodeNumber: 0,
          provider: "archive",
          providerAssetId: "a",
        },
      ],
    });
    const report = await service.syncProvider({ providerId: "archive" });

    assert.equal(report.created, 0);
    assert.equal(report.skippedExisting, 1);
    assert.equal(rows.size, 0);
  });

  it("never reopens a decided candidate", async () => {
    const { service, rows, insert } = setup({
      adapters: [
        discoverAdapter(async () => [
          { providerAssetId: "a", title: "Big Buck Bunny", year: 2008 },
        ]),
      ],
      titles: [BBB_TITLE],
    });
    const rejected = insert(candidateData({ providerAssetId: "a" }), {
      status: "REJECTED",
      decidedAt: NOW,
    });

    await service.syncProvider({ providerId: "archive" });

    assert.equal(rows.get(rejected.id)?.status, "REJECTED");
    assert.equal(rows.get(rejected.id)?.score, 100);
  });

  it("turns provider failures into report failures instead of throwing", async () => {
    const { service } = setup({
      adapters: [
        discoverAdapter(async () => ({ reason: "O provedor respondeu HTTP 503." })),
      ],
      titles: [BBB_TITLE],
    });
    const report = await service.syncProvider({ providerId: "archive" });

    assert.equal(report.created, 0);
    assert.deepEqual(report.failures, ["Label archive: O provedor respondeu HTTP 503."]);
  });

  it("turns a throwing adapter into a failure", async () => {
    const { service } = setup({
      adapters: [
        discoverAdapter(async () => {
          throw new Error("https://user:secret@host/x exploded");
        }),
      ],
      titles: [BBB_TITLE],
    });
    const report = await service.syncProvider({ providerId: "archive" });

    assert.deepEqual(report.failures, ["Label archive: Falha ao consultar o provedor."]);
    assert.ok(!JSON.stringify(report).includes("secret"));
  });

  it("stops after consecutive provider failures", async () => {
    let calls = 0;
    const titles = Array.from({ length: 9 }, (_, index) => ({
      ...BBB_TITLE,
      tmdbId: 100 + index,
    }));
    const { service } = setup({
      adapters: [
        discoverAdapter(async () => {
          calls += 1;
          return { reason: "fora do ar" };
        }),
      ],
      titles,
    });
    const report = await service.syncProvider({ providerId: "archive", limit: 50 });

    assert.equal(calls, 5);
    assert.equal(report.failures.length, 2);
    assert.match(report.failures[1], /interrompida/);
  });

  it("searches episodes by series with the season and episode of the title", async () => {
    let received: DiscoveryQuery | undefined;
    const { service, rows, tmdb } = setup({
      adapters: [
        discoverAdapter(async (query) => {
          received = query;
          return [
            {
              providerAssetId: "series:1399:2:5",
              title: "The Kingsroad",
              externalIds: { tmdb: 1399 },
            },
          ];
        }),
      ],
      titles: [GOT_EPISODE],
    });

    await service.syncProvider({ providerId: "archive" });

    assert.deepEqual(tmdb.calls, ["series-ext:1399"]);
    assert.equal(received?.mediaType, "EPISODE");
    assert.equal(received?.seasonNumber, 2);
    assert.equal(received?.episodeNumber, 5);

    const [row] = [...rows.values()];

    assert.equal(row.mediaType, "EPISODE");
    assert.equal(row.seasonNumber, 2);
    assert.equal(row.episodeNumber, 5);
    assert.equal(row.matchMethod, "TMDB_ID");
  });

  it("passes the limit (default 25, capped at 500) to the title scan", async () => {
    const { service, scanCalls } = setup({
      adapters: [discoverAdapter(async () => [])],
    });

    await service.syncProvider({ providerId: "archive" });
    await service.syncProvider({ providerId: "archive", limit: 7 });
    await service.syncProvider({ providerId: "archive", limit: 9_999 });

    assert.deepEqual(
      scanCalls.map((call) => call.limit),
      [25, 7, 500],
    );
    assert.ok(scanCalls.every((call) => call.provider === "archive"));
  });

  it("stops cleanly when the time budget is spent", async () => {
    let clock = NOW.getTime();
    let calls = 0;
    const { service } = setup({
      adapters: [
        discoverAdapter(async () => {
          calls += 1;
          clock += 30_000;
          return [];
        }),
      ],
      titles: [BBB_TITLE, { ...BBB_TITLE, tmdbId: 2 }, { ...BBB_TITLE, tmdbId: 3 }],
      limits: { timeBudgetMs: 40_000 },
      now: () => new Date(clock),
    });
    const report = await service.syncProvider({ providerId: "archive" });

    assert.equal(calls, 2);
    assert.equal(report.scanned, 2);
    assert.match(report.failures[0], /Tempo da sincronização esgotado/);
    assert.equal(report.durationMs, 60_000);
  });

  it("reports providers that cannot be synced", async () => {
    const { service } = setup({ adapters: [adapterOf("archive")] });
    const report = await service.syncProvider({ providerId: "archive" });

    assert.equal(report.scanned, 0);
    assert.match(report.failures[0], /não oferece sincronização/);
  });

  it("throws for an unknown provider", async () => {
    const { service } = setup();

    await assert.rejects(
      service.syncProvider({ providerId: "nope" }),
      (error: unknown) => error instanceof UnknownProviderError,
    );
  });
});

// ---- sync: catalog mode ------------------------------------------------------------

describe("syncProvider (catalog mode)", () => {
  it("uses the declared tmdb id directly, without asking TMDB", async () => {
    const { adapter } = catalogAdapter({
      start: { items: [movieItem({ externalIds: { tmdb: 10378 } })] },
    });
    const { service, rows, tmdb, associations } = setup({ adapters: [adapter] });
    const report = await service.syncProvider({ providerId: "meu-servidor" });

    assert.equal(report.mode, "catalog");
    assert.equal(report.scanned, 1);
    assert.equal(report.created, 1);
    assert.deepEqual(tmdb.calls, []);
    assert.equal(associations.created.length, 0);

    const [row] = [...rows.values()];

    assert.equal(row.matchMethod, "TMDB_ID");
    assert.equal(row.score, 100);
    assert.equal(row.tmdbId, 10378);
    assert.equal(row.providerAssetId, "vod:1");
  });

  it("resolves an imdb id through TMDB find", async () => {
    const { adapter } = catalogAdapter({
      start: { items: [movieItem({ externalIds: { imdb: "tt1254207" } })] },
    });
    const { service, rows, tmdb } = setup({
      adapters: [adapter],
      tmdb: { findTmdbByImdbId: async () => ({ movieId: 10378 }) },
    });
    const report = await service.syncProvider({ providerId: "meu-servidor" });

    assert.equal(report.created, 1);
    assert.deepEqual(tmdb.calls, []);

    const [row] = [...rows.values()];

    assert.equal(row.matchMethod, "IMDB_ID");
    assert.equal(row.score, 98);
    assert.equal(row.tmdbId, 10378);
  });

  it("does not guess by title when TMDB does not know the declared imdb id", async () => {
    const { adapter } = catalogAdapter({
      start: {
        items: [movieItem({ externalIds: { imdb: "tt9999999" }, year: 2008 })],
      },
    });
    const { service, rows, tmdb } = setup({ adapters: [adapter] });
    const report = await service.syncProvider({ providerId: "meu-servidor" });

    assert.equal(report.created, 0);
    assert.equal(rows.size, 0);
    assert.deepEqual(tmdb.calls, ["find:tt9999999"]);
  });

  it("uses the series id for an episode's imdb id", async () => {
    const { adapter } = catalogAdapter({
      start: { items: [episodeItem({ externalIds: { imdb: "tt0944947" } })] },
    });
    const { service, rows } = setup({
      adapters: [adapter],
      tmdb: { findTmdbByImdbId: async () => ({ movieId: 1, seriesId: 1399 }) },
    });

    await service.syncProvider({ providerId: "meu-servidor" });

    const [row] = [...rows.values()];

    assert.equal(row.tmdbId, 1399);
    assert.equal(row.mediaType, "EPISODE");
    assert.equal(row.seasonNumber, 2);
    assert.equal(row.episodeNumber, 5);
  });

  it("falls back to title + year against TMDB search (weak, METADATA)", async () => {
    const { adapter } = catalogAdapter({
      start: {
        items: [
          movieItem({ year: 2008 }),
          movieItem({ providerAssetId: "vod:2", year: 2008 }),
        ],
      },
    });
    const { service, rows, tmdb } = setup({
      adapters: [adapter],
      tmdb: {
        searchMovies: async () => [
          { tmdbId: 777, title: "Outro Filme", originalTitle: "Other", releaseYear: 2008 },
          {
            tmdbId: 10378,
            title: "Big Buck Bunny",
            originalTitle: "Big Buck Bunny",
            releaseYear: 2008,
          },
        ],
      },
    });
    const report = await service.syncProvider({ providerId: "meu-servidor" });

    assert.equal(report.created, 2);
    assert.ok(tmdb.calls.length === 0, "the fake override replaces the logging search");

    const [first] = [...rows.values()];

    assert.equal(first.matchMethod, "METADATA");
    assert.equal(first.tmdbId, 10378);
    assert.ok(first.score < BATCH_APPROVAL_MIN_SCORE);
  });

  it("caches the TMDB search per title within a run", async () => {
    const { adapter } = catalogAdapter({
      start: {
        items: [
          movieItem({ year: 2008 }),
          movieItem({ providerAssetId: "vod:2", year: 2008 }),
          movieItem({ providerAssetId: "vod:3", year: 2008 }),
        ],
      },
    });
    const { service, tmdb } = setup({ adapters: [adapter] });

    await service.syncProvider({ providerId: "meu-servidor" });

    assert.deepEqual(tmdb.calls, ["search-movie:Big Buck Bunny"]);
  });

  it("refuses an ambiguous title match (two TMDB titles tie)", async () => {
    const { adapter } = catalogAdapter({ start: { items: [movieItem({ year: 2008 })] } });
    const { service, rows } = setup({
      adapters: [adapter],
      tmdb: {
        searchMovies: async () => [
          { tmdbId: 1, title: "Big Buck Bunny", originalTitle: "", releaseYear: 2008 },
          { tmdbId: 2, title: "Big Buck Bunny", originalTitle: "", releaseYear: 2008 },
        ],
      },
    });
    const report = await service.syncProvider({ providerId: "meu-servidor" });

    assert.equal(report.created, 0);
    assert.equal(rows.size, 0);
  });

  it("needs a year for a metadata match", async () => {
    const { adapter } = catalogAdapter({ start: { items: [movieItem()] } });
    const { service, rows } = setup({
      adapters: [adapter],
      tmdb: {
        searchMovies: async () => [
          { tmdbId: 10378, title: "Big Buck Bunny", originalTitle: "", releaseYear: 2008 },
        ],
      },
    });

    await service.syncProvider({ providerId: "meu-servidor" });

    assert.equal(rows.size, 0);
  });

  it("matches an episode by series title through the series search", async () => {
    const { adapter } = catalogAdapter({
      start: { items: [episodeItem({ year: 2011 })] },
    });
    const { service, rows } = setup({
      adapters: [adapter],
      tmdb: {
        searchSeries: async () => [
          {
            tmdbId: 1399,
            title: "Game of Thrones",
            originalTitle: "Game of Thrones",
            releaseYear: 2011,
          },
        ],
      },
    });

    await service.syncProvider({ providerId: "meu-servidor" });

    const [row] = [...rows.values()];

    assert.equal(row.tmdbId, 1399);
    assert.equal(row.matchMethod, "METADATA");
    assert.equal(row.mediaType, "EPISODE");
  });

  it("ignores an episode without a valid season/episode number", async () => {
    const { adapter } = catalogAdapter({
      start: {
        items: [
          episodeItem({ externalIds: { tmdb: 1399 }, episodeNumber: 0 }),
          episodeItem({
            providerAssetId: "x",
            externalIds: { tmdb: 1399 },
            seasonNumber: undefined,
          }),
        ],
      },
    });
    const { service, rows } = setup({ adapters: [adapter] });
    const report = await service.syncProvider({ providerId: "meu-servidor" });

    assert.equal(report.scanned, 2);
    assert.equal(rows.size, 0);
  });

  it("follows the cursor across pages and respects the limit", async () => {
    const { adapter, requested } = catalogAdapter({
      start: {
        items: [
          movieItem({ providerAssetId: "vod:1", externalIds: { tmdb: 1 } }),
          movieItem({ providerAssetId: "vod:2", externalIds: { tmdb: 2 } }),
        ],
        nextCursor: "p2",
      },
      p2: {
        items: [
          movieItem({ providerAssetId: "vod:3", externalIds: { tmdb: 3 } }),
          movieItem({ providerAssetId: "vod:4", externalIds: { tmdb: 4 } }),
        ],
      },
    });
    const all = setup({ adapters: [adapter] });
    const report = await all.service.syncProvider({ providerId: "meu-servidor" });

    assert.deepEqual(requested, [undefined, "p2"]);
    assert.equal(report.scanned, 4);
    assert.equal(report.created, 4);

    const limited = catalogAdapter({
      start: {
        items: [
          movieItem({ providerAssetId: "vod:1", externalIds: { tmdb: 1 } }),
          movieItem({ providerAssetId: "vod:2", externalIds: { tmdb: 2 } }),
          movieItem({ providerAssetId: "vod:3", externalIds: { tmdb: 3 } }),
        ],
        nextCursor: "p2",
      },
    });
    const second = setup({ adapters: [limited.adapter] });
    const secondReport = await second.service.syncProvider({
      providerId: "meu-servidor",
      limit: 2,
    });

    assert.equal(secondReport.scanned, 2);
    assert.deepEqual(limited.requested, [undefined]);
  });

  it("stops on a repeated cursor", async () => {
    const { adapter, requested } = catalogAdapter({
      start: { items: [], nextCursor: "again" },
      again: { items: [], nextCursor: "again" },
    });
    const { service } = setup({ adapters: [adapter] });

    await service.syncProvider({ providerId: "meu-servidor" });

    assert.deepEqual(requested, [undefined, "again"]);
  });

  it("reports a failing page and keeps what was already stored", async () => {
    const { adapter } = catalogAdapter({
      start: {
        items: [movieItem({ externalIds: { tmdb: 10378 } })],
        nextCursor: "p2",
      },
      p2: { reason: "Servidor respondeu HTTP 500." },
    });
    const { service, rows } = setup({ adapters: [adapter] });
    const report = await service.syncProvider({ providerId: "meu-servidor" });

    assert.equal(report.created, 1);
    assert.equal(rows.size, 1);
    assert.deepEqual(report.failures, [
      "Catálogo de Label meu-servidor: Servidor respondeu HTTP 500.",
    ]);
  });

  it("stops when the TMDB query budget is spent", async () => {
    const { adapter } = catalogAdapter({
      start: {
        items: [
          movieItem({ providerAssetId: "a", externalIds: { imdb: "tt0000001" } }),
          movieItem({ providerAssetId: "b", externalIds: { imdb: "tt0000002" } }),
          movieItem({ providerAssetId: "c", externalIds: { imdb: "tt0000003" } }),
        ],
      },
    });
    const { service, tmdb } = setup({ adapters: [adapter], limits: { maxTmdbQueries: 2 } });
    const report = await service.syncProvider({ providerId: "meu-servidor" });

    assert.equal(report.scanned, 2);
    assert.equal(tmdb.calls.length, 2);
    assert.match(report.failures[0], /Limite de consultas à TMDB/);
  });

  it("survives TMDB errors and gives up after repeated ones", async () => {
    const items = Array.from({ length: 8 }, (_, index) =>
      movieItem({ providerAssetId: `v${index}`, externalIds: { imdb: `tt000000${index}` } }),
    );
    const { adapter } = catalogAdapter({ start: { items } });
    let calls = 0;
    const { service } = setup({
      adapters: [adapter],
      tmdb: {
        findTmdbByImdbId: async () => {
          calls += 1;
          throw new Error("TMDB down");
        },
      },
    });
    const report = await service.syncProvider({ providerId: "meu-servidor" });

    assert.equal(calls, 5);
    assert.equal(report.created, 0);
    assert.equal(report.failures.length, 2);
    assert.match(report.failures[1], /TMDB falhou várias vezes/);
  });

  it("stops when the time budget is spent between pages", async () => {
    let clock = NOW.getTime();
    const requested: (string | undefined)[] = [];
    const adapter = adapterOf("meu-servidor", {
      listCatalog: async (cursor) => {
        requested.push(cursor);
        clock += 50_000;
        return { items: [], nextCursor: `p${requested.length}` };
      },
    });
    const { service } = setup({ adapters: [adapter], now: () => new Date(clock) });
    const report = await service.syncProvider({ providerId: "meu-servidor" });

    assert.equal(requested.length, 1);
    assert.equal(report.durationMs, 50_000);
  });

  it("skips what already exists (idempotent)", async () => {
    const { adapter } = catalogAdapter({
      start: { items: [movieItem({ externalIds: { tmdb: 10378 } })] },
    });
    const { service } = setup({ adapters: [adapter] });

    await service.syncProvider({ providerId: "meu-servidor" });

    const second = await service.syncProvider({ providerId: "meu-servidor" });

    assert.equal(second.created, 0);
    assert.equal(second.skippedExisting, 1);
  });

  it("skips known items without spending TMDB queries or the limit", async () => {
    const { adapter } = catalogAdapter({
      start: {
        items: [
          movieItem({ providerAssetId: "old", externalIds: { imdb: "tt0000001" } }),
          movieItem({ providerAssetId: "new", externalIds: { imdb: "tt0000002" } }),
        ],
      },
    });
    const { service, tmdb, insert } = setup({ adapters: [adapter] });

    insert(candidateData({ provider: "meu-servidor", providerAssetId: "old" }));

    const report = await service.syncProvider({ providerId: "meu-servidor", limit: 1 });

    assert.equal(report.skippedExisting, 1);
    assert.equal(report.scanned, 1);
    assert.deepEqual(tmdb.calls, ["find:tt0000002"]);
  });

  it("gives up on a TMDB call that hangs past the call timeout", async () => {
    const { adapter } = catalogAdapter({
      start: { items: [movieItem({ externalIds: { imdb: "tt0000001" } })] },
    });
    const { service } = setup({
      adapters: [adapter],
      limits: { callTimeoutMs: 20 },
      tmdb: {
        findTmdbByImdbId: () =>
          new Promise<{ movieId?: number; seriesId?: number }>(() => {}),
      },
    });
    const report = await service.syncProvider({ providerId: "meu-servidor" });

    assert.equal(report.created, 0);
    assert.match(report.failures[0], /Falha ao consultar a TMDB/);
  });

  it("notes that a declared tmdb id was not cross-checked with TMDB", async () => {
    const { adapter } = catalogAdapter({
      start: { items: [movieItem({ externalIds: { tmdb: 10378 } })] },
    });
    const { service, rows } = setup({ adapters: [adapter] });

    await service.syncProvider({ providerId: "meu-servidor" });

    assert.match([...rows.values()][0].reason, /NÃO conferido/);
  });

  it("prefers the catalog over discover when an adapter has both", async () => {
    let discovered = 0;
    const adapter = adapterOf("meu-servidor", {
      listCatalog: async () => ({ items: [] }),
      discover: async () => {
        discovered += 1;
        return [];
      },
    });
    const { service } = setup({ adapters: [adapter], titles: [BBB_TITLE] });
    const report = await service.syncProvider({ providerId: "meu-servidor" });

    assert.equal(report.mode, "catalog");
    assert.equal(discovered, 0);
  });
});

// ---- approval ----------------------------------------------------------------

const STRONG = candidateData();

function strongRow(index: number, overrides: Partial<NewCandidate> = {}): NewCandidate {
  return candidateData({
    tmdbId: 1000 + index,
    providerAssetId: `asset-${index}`,
    providerTitle: `Filme ${index}`,
    ...overrides,
  });
}

const WEAK = candidateData({
  providerAssetId: "weak",
  matchMethod: "METADATA",
  score: 88,
  reason: "Título igual.",
});

describe("approveCandidates", () => {
  it("creates a VERIFIED association with the license the admin typed", async () => {
    const { service, insert, associations, rows } = setup();
    const candidate = insert(STRONG);
    const result = await service.approveCandidates({
      ids: [candidate.id],
      licenseReference: `  ${LICENSE}  `,
    });

    assert.deepEqual(result, { approved: 1, skipped: 0, errors: [] });
    assert.equal(associations.created.length, 1);
    assert.deepEqual(associations.created[0], {
      tmdbId: 10378,
      mediaType: "MOVIE",
      seasonNumber: 0,
      episodeNumber: 0,
      provider: "archive",
      providerAssetId: "BigBuckBunny_124",
      playbackType: null,
      rightsStatus: "VERIFIED",
      licenseReference: LICENSE,
    });
    assert.equal(rows.get(candidate.id)?.status, "APPROVED");
    assert.deepEqual(rows.get(candidate.id)?.decidedAt, NOW);
  });

  it("needs a license of at least 10 characters and approves nothing without it", async () => {
    const { service, insert, associations, rows } = setup();
    const candidate = insert(STRONG);

    for (const licenseReference of ["", "   ", "curta", "  123456789  "]) {
      const result = await service.approveCandidates({
        ids: [candidate.id],
        licenseReference,
      });

      assert.equal(result.approved, 0);
      assert.match(result.errors[0], /licença ou o contrato/);
    }

    assert.equal(associations.created.length, 0);
    assert.equal(rows.get(candidate.id)?.status, "PENDING");
  });

  it("refuses a batch unless the admin confirms the license covers every title", async () => {
    const { service, insert, associations } = setup();
    const ids = [insert(strongRow(1)).id, insert(strongRow(2)).id];

    for (const licenseCoversAllSelected of [undefined, false]) {
      const result = await service.approveCandidates({
        ids,
        licenseReference: LICENSE,
        licenseCoversAllSelected,
      });

      assert.equal(result.approved, 0);
      assert.match(result.errors[0], /abrange TODOS os 2 títulos/);
    }

    assert.equal(associations.created.length, 0);
  });

  it("approves a confirmed batch of one provider and checks each association", async () => {
    const { service, insert, associations, rows } = setup();
    const ids = [insert(strongRow(1)).id, insert(strongRow(2)).id, insert(strongRow(3)).id];
    const result = await service.approveCandidates({
      ids,
      licenseReference: LICENSE,
      licenseCoversAllSelected: true,
    });

    assert.deepEqual(result, { approved: 3, skipped: 0, errors: [] });
    assert.deepEqual(associations.verified, ["assoc-1", "assoc-2", "assoc-3"]);
    assert.ok(associations.created.every((row) => row.rightsStatus === "VERIFIED"));
    assert.ok(ids.every((id) => rows.get(id)?.status === "APPROVED"));
  });

  it("refuses a batch that mixes providers", async () => {
    const { service, insert, associations } = setup({
      adapters: [adapterOf("archive"), adapterOf("peertube")],
    });
    const ids = [
      insert(strongRow(1)).id,
      insert(strongRow(2, { provider: "peertube" })).id,
    ];
    const result = await service.approveCandidates({
      ids,
      licenseReference: LICENSE,
      licenseCoversAllSelected: true,
    });

    assert.equal(result.approved, 0);
    assert.match(result.errors[0], /único provedor/);
    assert.equal(associations.created.length, 0);
  });

  it("leaves weak (metadata) candidates out of a batch and says so", async () => {
    const { service, insert, associations, rows } = setup();
    const strong = insert(strongRow(1));
    const weak = insert(WEAK);
    const result = await service.approveCandidates({
      ids: [strong.id, weak.id],
      licenseReference: LICENSE,
      licenseCoversAllSelected: true,
      acknowledgeMetadataMatch: true,
    });

    assert.equal(result.approved, 1);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /individualmente/);
    assert.equal(associations.created.length, 1);
    assert.equal(rows.get(weak.id)?.status, "PENDING");
  });

  it("treats an identifier match below 95 as weak", async () => {
    const { service, insert, associations } = setup();
    const odd = insert(candidateData({ score: BATCH_APPROVAL_MIN_SCORE - 1 }));
    const result = await service.approveCandidates({
      ids: [odd.id],
      licenseReference: LICENSE,
    });

    assert.equal(result.approved, 0);
    assert.match(result.errors[0], /título\/ano/);
    assert.equal(associations.created.length, 0);
  });

  it("approves ONE metadata candidate only with the explicit acknowledgement", async () => {
    const { service, insert, associations, rows } = setup();
    const weak = insert(WEAK);
    const without = await service.approveCandidates({
      ids: [weak.id],
      licenseReference: LICENSE,
    });
    const falsy = await service.approveCandidates({
      ids: [weak.id],
      licenseReference: LICENSE,
      acknowledgeMetadataMatch: false,
    });

    assert.equal(without.approved + falsy.approved, 0);
    assert.equal(associations.created.length, 0);

    const acknowledged = await service.approveCandidates({
      ids: [weak.id],
      licenseReference: LICENSE,
      acknowledgeMetadataMatch: true,
    });

    assert.equal(acknowledged.approved, 1);
    assert.equal(associations.created[0].licenseReference, LICENSE);
    assert.equal(rows.get(weak.id)?.status, "APPROVED");
  });

  it("is idempotent: an existing VERIFIED association is skipped and the candidate leaves the queue", async () => {
    const { service, insert, associations, rows } = setup({
      associations: {
        existing: [
          {
            tmdbId: 10378,
            mediaType: "MOVIE",
            seasonNumber: 0,
            episodeNumber: 0,
            provider: "archive",
            providerAssetId: "BigBuckBunny_124",
          },
        ],
      },
    });
    const candidate = insert(STRONG);
    const result = await service.approveCandidates({
      ids: [candidate.id],
      licenseReference: LICENSE,
    });

    assert.deepEqual(result, { approved: 0, skipped: 1, errors: [] });
    assert.equal(associations.verified.length, 0);
    assert.equal(rows.get(candidate.id)?.status, "APPROVED");
  });

  it("does not override an existing association that is not VERIFIED, and says so", async () => {
    const { service, insert, associations, rows } = setup({
      associations: {
        existingRights: "REVOKED",
        existing: [
          {
            tmdbId: 10378,
            mediaType: "MOVIE",
            seasonNumber: 0,
            episodeNumber: 0,
            provider: "archive",
            providerAssetId: "BigBuckBunny_124",
          },
        ],
      },
    });
    const candidate = insert(STRONG);
    const result = await service.approveCandidates({
      ids: [candidate.id],
      licenseReference: LICENSE,
    });

    assert.equal(result.approved, 0);
    assert.equal(result.skipped, 1);
    assert.match(result.errors[0], /direitos REVOKED/);
    assert.equal(associations.created.length, 0);
    assert.equal(rows.get(candidate.id)?.status, "REJECTED");
  });

  it("skips an already approved candidate and reports a rejected one", async () => {
    const { service, insert, associations } = setup();
    const approved = insert(strongRow(1), { status: "APPROVED", decidedAt: NOW });
    const rejected = insert(strongRow(2), { status: "REJECTED", decidedAt: NOW });
    const result = await service.approveCandidates({
      ids: [approved.id, rejected.id],
      licenseReference: LICENSE,
      licenseCoversAllSelected: true,
    });

    assert.equal(result.approved, 0);
    assert.equal(result.skipped, 1);
    assert.match(result.errors[0], /rejeitado/);
    assert.equal(associations.created.length, 0);
  });

  it("reports unknown ids and unknown providers", async () => {
    const { service, insert, associations } = setup();
    const orphan = insert(strongRow(1, { provider: "removido" }));
    const result = await service.approveCandidates({
      ids: [orphan.id, "missing-id"],
      licenseReference: LICENSE,
      licenseCoversAllSelected: true,
    });

    assert.equal(result.approved, 0);
    assert.equal(result.errors.length, 2);
    assert.ok(result.errors.some((message) => /não encontrado/.test(message)));
    assert.ok(result.errors.some((message) => /provedor desconhecido/.test(message)));
    assert.equal(associations.created.length, 0);
  });

  it("deduplicates ids (a repeated id is not a batch)", async () => {
    const { service, insert, associations } = setup();
    const candidate = insert(STRONG);
    const result = await service.approveCandidates({
      ids: [candidate.id, candidate.id],
      licenseReference: LICENSE,
    });

    assert.equal(result.approved, 1);
    assert.equal(associations.created.length, 1);
  });

  it("verifies at most 25 new associations and never fails because of it", async () => {
    const { service, insert, associations } = setup({ associations: { verifyThrows: true } });
    const ids = Array.from({ length: 30 }, (_, index) => insert(strongRow(index)).id);
    const result = await service.approveCandidates({
      ids,
      licenseReference: LICENSE,
      licenseCoversAllSelected: true,
    });

    assert.equal(result.approved, 30);
    assert.deepEqual(result.errors, []);
    assert.equal(associations.verified.length, 25);
  });

  it("approves an episode candidate with its season and episode", async () => {
    const { service, insert, associations } = setup();
    const candidate = insert(
      candidateData({
        tmdbId: 1399,
        mediaType: "EPISODE",
        seasonNumber: 2,
        episodeNumber: 5,
        providerAssetId: "series:1399:2:5",
      }),
    );

    await service.approveCandidates({ ids: [candidate.id], licenseReference: LICENSE });

    assert.equal(associations.created[0].mediaType, "EPISODE");
    assert.equal(associations.created[0].seasonNumber, 2);
    assert.equal(associations.created[0].episodeNumber, 5);
  });

  it("rejects an empty selection", async () => {
    const { service } = setup();
    const result = await service.approveCandidates({ ids: [], licenseReference: LICENSE });

    assert.equal(result.approved, 0);
    assert.match(result.errors[0], /ao menos um/);
  });
});

// ---- reject / list / reverify -------------------------------------------------------

describe("rejectCandidates", () => {
  it("rejects only pending candidates", async () => {
    const { service, insert, rows } = setup();
    const pending = insert(strongRow(1));
    const approved = insert(strongRow(2), { status: "APPROVED", decidedAt: NOW });

    assert.equal(await service.rejectCandidates([pending.id, approved.id, pending.id]), 1);
    assert.equal(rows.get(pending.id)?.status, "REJECTED");
    assert.equal(rows.get(approved.id)?.status, "APPROVED");
    assert.equal(await service.rejectCandidates([]), 0);
  });
});

describe("listCandidates", () => {
  it("orders by score then recency and applies the filters", async () => {
    const { service, insert } = setup();

    insert(strongRow(1, { score: 98, matchMethod: "IMDB_ID" }));
    insert(strongRow(2, { score: 100 }));
    insert(strongRow(3, { score: 80, matchMethod: "METADATA", provider: "peertube" }));
    insert(strongRow(4, { score: 100 }), { status: "REJECTED" });

    const pending = await service.listCandidates({ status: "PENDING" });

    assert.deepEqual(
      pending.map((row) => row.score),
      [100, 98, 80],
    );
    assert.equal((await service.listCandidates({ provider: "peertube" })).length, 1);
    assert.equal((await service.listCandidates({ minScore: 95 })).length, 3);
    assert.equal((await service.listCandidates()).length, 4);
  });
});

describe("reverifyAssociations", () => {
  it("includes unavailable associations by default and counts the outcomes", async () => {
    const { service, associations } = setup({
      associations: {
        reverifyIds: ["a1", "a2", "a3"],
        unavailable: new Set(["a2"]),
      },
    });
    const result = await service.reverifyAssociations();

    assert.deepEqual(result, { checked: 3, available: 2, unavailable: 1 });
    assert.deepEqual(associations.reverifyCalls, [{ limit: 25, includeUnavailable: true }]);
  });

  it("caps the limit and honors includeUnavailable: false", async () => {
    const { service, associations } = setup();

    await service.reverifyAssociations({ limit: 5_000, includeUnavailable: false });
    await service.reverifyAssociations({ limit: 0 });

    assert.deepEqual(associations.reverifyCalls, [
      { limit: 100, includeUnavailable: false },
      { limit: 1, includeUnavailable: true },
    ]);
  });

  it("does not count associations whose verification threw", async () => {
    const { service } = setup({
      associations: { reverifyIds: ["a1", "a2"], verifyThrows: true },
    });

    assert.deepEqual(await service.reverifyAssociations(), {
      checked: 0,
      available: 0,
      unavailable: 0,
    });
  });
});
