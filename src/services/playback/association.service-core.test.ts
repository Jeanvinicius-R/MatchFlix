import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CreateAssociationInput } from "../../schemas/playback-association.schemas";
import type { AdapterFailure, PlaybackAdapter, ResolvedAsset } from "./adapters/adapter.types";
import {
  AssociationAlreadyExistsError,
  AssociationNotFoundError,
  LicenseReferenceRequiredError,
  OPEN_FILMS,
  UnknownProviderError,
  createAssociationService,
  type AssociationRepository,
  type AssociationView,
} from "./association.service-core";

const NOW = new Date("2026-11-18T12:00:00.000Z");

function memoryRepository() {
  const rows = new Map<string, AssociationView>();
  let sequence = 0;

  const naturalKey = (row: {
    tmdbId: number;
    mediaType: string;
    seasonNumber: number;
    episodeNumber: number;
    provider: string;
    providerAssetId: string;
  }) =>
    [
      row.tmdbId,
      row.mediaType,
      row.seasonNumber,
      row.episodeNumber,
      row.provider,
      row.providerAssetId,
    ].join("|");

  const repository: AssociationRepository = {
    async list() {
      return [...rows.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async create(data) {
      if ([...rows.values()].some((row) => naturalKey(row) === naturalKey(data))) {
        return null;
      }

      sequence += 1;
      const row: AssociationView = {
        id: `id-${sequence}`,
        ...data,
        availabilityStatus: "UNKNOWN",
        lastVerifiedAt: null,
        createdAt: new Date(1_700_000_000_000 + sequence * 1_000),
      };
      rows.set(row.id, row);
      return row;
    },
    async updateRights(id, data) {
      const row = rows.get(id);

      if (!row) {
        return null;
      }

      const updated: AssociationView = {
        ...row,
        rightsStatus: data.rightsStatus,
        licenseReference:
          data.licenseReference === undefined ? row.licenseReference : data.licenseReference,
      };
      rows.set(id, updated);
      return updated;
    },
    async updateAvailability(id, availabilityStatus, lastVerifiedAt) {
      const row = rows.get(id);

      if (row) {
        rows.set(id, { ...row, availabilityStatus, lastVerifiedAt });
      }
    },
    async remove(id) {
      return rows.delete(id);
    },
  };

  return { rows, repository };
}

type Resolve = (assetId: string, signal: AbortSignal) => Promise<ResolvedAsset | AdapterFailure>;

function fakeAdapter(id: string, resolve: Resolve = async () => OK_ASSET): PlaybackAdapter {
  return {
    id,
    label: `Label ${id}`,
    assetIdHint: `hint ${id}`,
    resolve: (assetId, { signal }) => resolve(assetId, signal),
  };
}

const OK_ASSET: ResolvedAsset = { type: "direct", url: "https://cdn.example.org/film.mp4" };

function setup(adapters: PlaybackAdapter[] = [fakeAdapter("archive"), fakeAdapter("peertube")]) {
  const memory = memoryRepository();
  const service = createAssociationService({
    repository: memory.repository,
    adapters,
    now: () => NOW,
  });

  return { ...memory, service };
}

const MOVIE: CreateAssociationInput = {
  tmdbId: 10378,
  mediaType: "MOVIE",
  seasonNumber: 0,
  episodeNumber: 0,
  provider: "archive",
  providerAssetId: "BigBuckBunny_124",
};

describe("createAssociation", () => {
  it("always creates UNVERIFIED with availability UNKNOWN", async () => {
    const { service } = setup();
    const created = await service.createAssociation({
      ...MOVIE,
      playbackType: "MP4",
      licenseReference: "  CC BY 3.0 - Blender Foundation  ",
    });

    assert.equal(created.rightsStatus, "UNVERIFIED");
    assert.equal(created.availabilityStatus, "UNKNOWN");
    assert.equal(created.lastVerifiedAt, null);
    assert.equal(created.playbackType, "MP4");
    assert.equal(created.licenseReference, "CC BY 3.0 - Blender Foundation");
  });

  it("cannot be tricked into VERIFIED by extra input fields", async () => {
    const { service } = setup();
    const sneaky = { ...MOVIE, rightsStatus: "VERIFIED" } as CreateAssociationInput;
    const created = await service.createAssociation(sneaky);

    assert.equal(created.rightsStatus, "UNVERIFIED");
  });

  it("stores null for an absent or blank license and playback type", async () => {
    const { service } = setup();
    const first = await service.createAssociation(MOVIE);
    const second = await service.createAssociation({
      ...MOVIE,
      providerAssetId: "other",
      licenseReference: "   ",
    });

    assert.equal(first.playbackType, null);
    assert.equal(first.licenseReference, null);
    assert.equal(second.licenseReference, null);
  });

  it("creates episode associations keyed by series id, season and episode", async () => {
    const { service } = setup();
    const created = await service.createAssociation({
      tmdbId: 1399,
      mediaType: "EPISODE",
      seasonNumber: 2,
      episodeNumber: 5,
      provider: "peertube",
      providerAssetId: "tube.example.org/abc",
    });

    assert.equal(created.mediaType, "EPISODE");
    assert.equal(created.seasonNumber, 2);
    assert.equal(created.episodeNumber, 5);
  });

  it("rejects an unregistered provider and stores nothing", async () => {
    const { service, rows } = setup();

    await assert.rejects(
      service.createAssociation({ ...MOVIE, provider: "pirate-site" }),
      UnknownProviderError,
    );
    assert.equal(rows.size, 0);
  });

  it("rejects a duplicate", async () => {
    const { service, rows } = setup();
    await service.createAssociation(MOVIE);

    await assert.rejects(service.createAssociation(MOVIE), AssociationAlreadyExistsError);
    assert.equal(rows.size, 1);
  });

  it("allows the same title with another asset or another provider", async () => {
    const { service, rows } = setup();
    await service.createAssociation(MOVIE);
    await service.createAssociation({ ...MOVIE, providerAssetId: "Other_Item" });
    await service.createAssociation({ ...MOVIE, provider: "peertube" });

    assert.equal(rows.size, 3);
  });

  it("re-validates the input (invariants of the model)", async () => {
    const { service, rows } = setup();
    const invalid: CreateAssociationInput[] = [
      { ...MOVIE, seasonNumber: 1 },
      { ...MOVIE, episodeNumber: 1 },
      { ...MOVIE, mediaType: "EPISODE", seasonNumber: 1, episodeNumber: 0 },
      { ...MOVIE, tmdbId: 0 },
      { ...MOVIE, providerAssetId: "   " },
      { ...MOVIE, providerAssetId: "x".repeat(301) },
      { ...MOVIE, provider: "" },
    ];

    for (const input of invalid) {
      await assert.rejects(service.createAssociation(input), JSON.stringify(input));
    }
    assert.equal(rows.size, 0);
  });

  it("lists newest first", async () => {
    const { service } = setup();
    await service.createAssociation({ ...MOVIE, providerAssetId: "first" });
    await service.createAssociation({ ...MOVIE, providerAssetId: "second" });

    const list = await service.listAssociations();
    assert.deepEqual(
      list.map((row) => row.providerAssetId),
      ["second", "first"],
    );
  });
});

describe("setAssociationRights", () => {
  it("promotes to VERIFIED only through this explicit call", async () => {
    const { service } = setup();
    const created = await service.createAssociation(MOVIE);
    const updated = await service.setAssociationRights({
      id: created.id,
      rightsStatus: "VERIFIED",
      licenseReference: " CC BY 3.0 ",
    });

    assert.equal(updated.rightsStatus, "VERIFIED");
    assert.equal(updated.licenseReference, "CC BY 3.0");
  });

  it("keeps the stored reference when none is given, and clears it when blank", async () => {
    const { service } = setup();
    const created = await service.createAssociation({ ...MOVIE, licenseReference: "CC BY" });

    const revoked = await service.setAssociationRights({
      id: created.id,
      rightsStatus: "REVOKED",
    });
    assert.equal(revoked.rightsStatus, "REVOKED");
    assert.equal(revoked.licenseReference, "CC BY");

    const cleared = await service.setAssociationRights({
      id: created.id,
      rightsStatus: "EXPIRED",
      licenseReference: "  ",
    });
    assert.equal(cleared.rightsStatus, "EXPIRED");
    assert.equal(cleared.licenseReference, null);
  });

  it("refuses VERIFIED without a license reference, given or stored", async () => {
    const { service, rows } = setup();
    const bare = await service.createAssociation(MOVIE);

    for (const licenseReference of [undefined, "", "   "]) {
      await assert.rejects(
        service.setAssociationRights({
          id: bare.id,
          rightsStatus: "VERIFIED",
          licenseReference,
        }),
        LicenseReferenceRequiredError,
      );
    }
    assert.equal(rows.get(bare.id)?.rightsStatus, "UNVERIFIED");

    // Blanking the reference of a documented title cannot verify it either.
    const documented = await service.createAssociation({
      ...MOVIE,
      providerAssetId: "documented",
      licenseReference: "CC BY 3.0",
    });
    await assert.rejects(
      service.setAssociationRights({
        id: documented.id,
        rightsStatus: "VERIFIED",
        licenseReference: " ",
      }),
      LicenseReferenceRequiredError,
    );
  });

  it("accepts VERIFIED when the stored reference is kept", async () => {
    const { service } = setup();
    const created = await service.createAssociation({ ...MOVIE, licenseReference: "CC BY 3.0" });
    const updated = await service.setAssociationRights({
      id: created.id,
      rightsStatus: "VERIFIED",
    });

    assert.equal(updated.rightsStatus, "VERIFIED");
    assert.equal(updated.licenseReference, "CC BY 3.0");
  });

  it("throws AssociationNotFoundError for an unknown id", async () => {
    const { service } = setup();

    await assert.rejects(
      service.setAssociationRights({ id: "missing", rightsStatus: "VERIFIED" }),
      AssociationNotFoundError,
    );
  });
});

describe("verifyAssociation", () => {
  it("records AVAILABLE and the check time", async () => {
    const seen: { assetId: string; signal: AbortSignal }[] = [];
    const { service, rows } = setup([
      fakeAdapter("archive", async (assetId, signal) => {
        seen.push({ assetId, signal });
        return OK_ASSET;
      }),
    ]);
    const created = await service.createAssociation(MOVIE);

    assert.deepEqual(await service.verifyAssociation(created.id), {
      availabilityStatus: "AVAILABLE",
    });
    assert.equal(rows.get(created.id)?.availabilityStatus, "AVAILABLE");
    assert.equal(rows.get(created.id)?.lastVerifiedAt?.getTime(), NOW.getTime());
    assert.equal(seen[0].assetId, "BigBuckBunny_124");
    assert.ok(seen[0].signal instanceof AbortSignal);
  });

  it("does not change the rights decision", async () => {
    const { service, rows } = setup();
    const created = await service.createAssociation(MOVIE);
    await service.verifyAssociation(created.id);

    assert.equal(rows.get(created.id)?.rightsStatus, "UNVERIFIED");
  });

  it("records UNAVAILABLE with the adapter's reason", async () => {
    const { service, rows } = setup([
      fakeAdapter("archive", async () => ({ reason: "O item não declara licença." })),
    ]);
    const created = await service.createAssociation(MOVIE);

    assert.deepEqual(await service.verifyAssociation(created.id), {
      availabilityStatus: "UNAVAILABLE",
      reason: "O item não declara licença.",
    });
    assert.equal(rows.get(created.id)?.availabilityStatus, "UNAVAILABLE");
    assert.equal(rows.get(created.id)?.lastVerifiedAt?.getTime(), NOW.getTime());
  });

  it("turns an adapter exception (network error) into UNAVAILABLE instead of throwing", async () => {
    const { service, rows } = setup([
      fakeAdapter("archive", async () => {
        throw new TypeError("fetch failed");
      }),
    ]);
    const created = await service.createAssociation(MOVIE);
    const result = await service.verifyAssociation(created.id);

    assert.equal(result.availabilityStatus, "UNAVAILABLE");
    assert.ok(result.reason && result.reason.length > 0);
    assert.equal(rows.get(created.id)?.availabilityStatus, "UNAVAILABLE");
  });

  it("marks UNAVAILABLE when the adapter returns an unsafe URL", async () => {
    const { service } = setup([
      fakeAdapter("archive", async () => ({ type: "direct", url: "http://cdn.example.org/a.mp4" })),
    ]);
    const created = await service.createAssociation(MOVIE);
    const result = await service.verifyAssociation(created.id);

    assert.equal(result.availabilityStatus, "UNAVAILABLE");
  });

  describe("protected (proxied) media", () => {
    const ORIGIN = "https://media.example.org";
    const SECRET_URL = `${ORIGIN}/movie/user/s3cr3t/42.mp4`;

    function proxied(overrides: {
      type?: "direct" | "hls" | "dash";
      upstreamUrl?: string;
      allowedOrigins?: string[];
    }): ResolvedAsset {
      return {
        type: overrides.type ?? "direct",
        proxy: {
          upstreamUrl: overrides.upstreamUrl ?? SECRET_URL,
          allowedOrigins: overrides.allowedOrigins ?? [ORIGIN],
        },
      };
    }

    it("is AVAILABLE when the proxy could serve it (no public url needed)", async () => {
      const { service, rows } = setup([fakeAdapter("archive", async () => proxied({}))]);
      const created = await service.createAssociation(MOVIE);

      assert.deepEqual(await service.verifyAssociation(created.id), {
        availabilityStatus: "AVAILABLE",
      });
      assert.equal(rows.get(created.id)?.availabilityStatus, "AVAILABLE");
    });

    it("is UNAVAILABLE when the upstream is outside the allowed origins", async () => {
      const { service } = setup([
        fakeAdapter("archive", async () =>
          proxied({ allowedOrigins: ["https://other.example.org"] }),
        ),
      ]);
      const created = await service.createAssociation(MOVIE);
      const result = await service.verifyAssociation(created.id);

      assert.equal(result.availabilityStatus, "UNAVAILABLE");
      assert.match(result.reason ?? "", /origens permitidas/);
    });

    it("is UNAVAILABLE for DASH (a manifest the proxy cannot rewrite)", async () => {
      const { service } = setup([
        fakeAdapter("archive", async () => proxied({ type: "dash" })),
      ]);
      const created = await service.createAssociation(MOVIE);

      assert.equal((await service.verifyAssociation(created.id)).availabilityStatus, "UNAVAILABLE");
    });

    it("never puts the upstream URL or its credentials in the reason", async () => {
      const { service } = setup([
        fakeAdapter("archive", async () => proxied({ allowedOrigins: [] })),
      ]);
      const created = await service.createAssociation(MOVIE);
      const result = await service.verifyAssociation(created.id);

      assert.equal(result.availabilityStatus, "UNAVAILABLE");
      assert.ok(!(result.reason ?? "").includes("s3cr3t"));
      assert.ok(!(result.reason ?? "").includes(SECRET_URL));
    });
  });

  it("marks UNAVAILABLE when the provider is no longer registered", async () => {
    const memory = memoryRepository();
    const row = await memory.repository.create({
      ...MOVIE,
      provider: "gone",
      playbackType: null,
      rightsStatus: "UNVERIFIED",
      licenseReference: null,
    });
    const service = createAssociationService({
      repository: memory.repository,
      adapters: [fakeAdapter("archive")],
      now: () => NOW,
    });
    const result = await service.verifyAssociation(row!.id);

    assert.equal(result.availabilityStatus, "UNAVAILABLE");
    assert.match(result.reason ?? "", /gone/);
  });

  it("can flip back to AVAILABLE on a later successful check", async () => {
    let failing = true;
    const { service, rows } = setup([
      fakeAdapter("archive", async () => (failing ? { reason: "fora do ar" } : OK_ASSET)),
    ]);
    const created = await service.createAssociation(MOVIE);

    await service.verifyAssociation(created.id);
    assert.equal(rows.get(created.id)?.availabilityStatus, "UNAVAILABLE");
    failing = false;
    await service.verifyAssociation(created.id);
    assert.equal(rows.get(created.id)?.availabilityStatus, "AVAILABLE");
  });

  it("throws AssociationNotFoundError for an unknown id", async () => {
    const { service } = setup();
    await assert.rejects(service.verifyAssociation("missing"), AssociationNotFoundError);
  });
});

describe("removeAssociation", () => {
  it("deletes the association", async () => {
    const { service, rows } = setup();
    const created = await service.createAssociation(MOVIE);
    await service.removeAssociation(created.id);

    assert.equal(rows.size, 0);
  });

  it("throws AssociationNotFoundError for an unknown id", async () => {
    const { service } = setup();
    await assert.rejects(service.removeAssociation("missing"), AssociationNotFoundError);
  });
});

describe("seedOpenFilmAssociations", () => {
  it("creates the four Blender films as VERIFIED CC BY MP4 movies on the archive adapter", async () => {
    const { service, rows } = setup();

    assert.deepEqual(await service.seedOpenFilmAssociations(), { created: 4, skipped: 0 });
    assert.equal(rows.size, 4);

    const byTmdb = new Map([...rows.values()].map((row) => [row.tmdbId, row]));
    assert.deepEqual(
      [...byTmdb.keys()].sort((a, b) => a - b),
      [9761, 10378, 45745, 133701],
    );
    assert.equal(byTmdb.get(10378)?.providerAssetId, "BigBuckBunny_124");
    assert.equal(byTmdb.get(45745)?.providerAssetId, "Sintel");
    assert.equal(byTmdb.get(133701)?.providerAssetId, "Tears-of-Steel");
    assert.equal(byTmdb.get(9761)?.providerAssetId, "ElephantsDream");

    for (const row of rows.values()) {
      assert.equal(row.provider, "archive");
      assert.equal(row.mediaType, "MOVIE");
      assert.equal(row.seasonNumber, 0);
      assert.equal(row.episodeNumber, 0);
      assert.equal(row.playbackType, "MP4");
      assert.equal(row.rightsStatus, "VERIFIED");
      assert.match(row.licenseReference ?? "", /^CC BY (2\.5|3\.0) - Blender Foundation/);
      assert.match(row.licenseReference ?? "", /\.blender\.org\)$/);
    }
    assert.match(byTmdb.get(9761)?.licenseReference ?? "", /^CC BY 2\.5/);
  });

  it("is idempotent", async () => {
    const { service, rows } = setup();
    await service.seedOpenFilmAssociations();

    assert.deepEqual(await service.seedOpenFilmAssociations(), { created: 0, skipped: 4 });
    assert.equal(rows.size, 4);
  });

  it("only creates what is missing", async () => {
    const { service, rows } = setup();
    await service.seedOpenFilmAssociations();
    const sintel = [...rows.values()].find((row) => row.tmdbId === 45745)!;
    await service.removeAssociation(sintel.id);

    assert.deepEqual(await service.seedOpenFilmAssociations(), { created: 1, skipped: 3 });
  });

  it("never overrides an admin's later decision", async () => {
    const { service, rows } = setup();
    await service.seedOpenFilmAssociations();
    const bunny = [...rows.values()].find((row) => row.tmdbId === 10378)!;
    await service.setAssociationRights({ id: bunny.id, rightsStatus: "REVOKED" });
    await service.seedOpenFilmAssociations();

    assert.equal(rows.get(bunny.id)?.rightsStatus, "REVOKED");
  });

  it("refuses to seed without the archive adapter registered", async () => {
    const { service, rows } = setup([fakeAdapter("peertube")]);

    await assert.rejects(service.seedOpenFilmAssociations(), UnknownProviderError);
    assert.equal(rows.size, 0);
  });

  it("lists exactly four distinct films", () => {
    assert.equal(OPEN_FILMS.length, 4);
    assert.equal(new Set(OPEN_FILMS.map((film) => film.tmdbId)).size, 4);
    assert.equal(new Set(OPEN_FILMS.map((film) => film.assetId)).size, 4);
  });
});

describe("listAdapters", () => {
  it("exposes id, label, the asset hint and the capabilities", () => {
    const { service } = setup();

    assert.deepEqual(service.listAdapters(), [
      {
        id: "archive",
        label: "Label archive",
        assetIdHint: "hint archive",
        canDiscover: false,
        canListCatalog: false,
      },
      {
        id: "peertube",
        label: "Label peertube",
        assetIdHint: "hint peertube",
        canDiscover: false,
        canListCatalog: false,
      },
    ]);
  });

  it("reports discover/listCatalog and the provider-level license suggestion", () => {
    const server: PlaybackAdapter = {
      ...fakeAdapter("meu-servidor"),
      discover: async () => [],
      listCatalog: async () => ({ items: [] }),
      licenseReference: "Contrato 2026/17 com o distribuidor X",
    };
    const { service } = setup([fakeAdapter("archive"), server]);
    const [plain, configured] = service.listAdapters();

    assert.equal(plain.canDiscover, false);
    assert.equal("suggestedLicenseReference" in plain, false);
    assert.equal(configured.canDiscover, true);
    assert.equal(configured.canListCatalog, true);
    assert.equal(configured.suggestedLicenseReference, "Contrato 2026/17 com o distribuidor X");
  });
});

describe("error classes", () => {
  it("carry a Portuguese message and their own name", () => {
    for (const error of [
      new AssociationAlreadyExistsError(),
      new UnknownProviderError("x"),
      new AssociationNotFoundError(),
      new LicenseReferenceRequiredError(),
    ]) {
      assert.ok(error instanceof Error);
      assert.equal(error.name, error.constructor.name);
      assert.ok(error.message.length > 0);
    }
  });
});
