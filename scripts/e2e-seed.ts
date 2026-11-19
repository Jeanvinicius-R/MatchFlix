import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import config from "../e2e/e2e-config.json";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/password";
import { hashEntryUrl } from "../src/services/playback/adapters/servers/m3u-parser";
import { discoverPeerTubeVideo } from "./lib/live-lib";

/**
 * Seeds the database of the e2e-chrome job (never use it on a real database):
 * a test ADMIN with one profile, local Movie rows (so no TMDB token is needed)
 * and the PlaybackAssociation rows of every scenario. The PLAYBACK_SERVERS the
 * Next server must start with is printed by e2e/servers-env.mjs from the same
 * e2e/e2e-config.json; this script only has to know the entry ids.
 *
 * It also picks a real PeerTube video at run time (the one thing that must be
 * known BEFORE the server starts: its hosts go into PEERTUBE_ALLOWED_INSTANCES).
 *
 * Writes e2e-out/seed.json (read by e2e/playback.e2e.mjs) and
 * e2e-out/peertube-hosts.txt (empty when no PeerTube video was found).
 */

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL não está definida.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const OUT_DIR = "e2e-out";
const LICENSE = config.licenseReference;
const { mock, titles } = config;

type RightsSeed = "VERIFIED" | "UNVERIFIED";
type FormatSeed = "MP4" | "HLS";

interface TitleEntry {
  tmdbId: number;
  slug: string;
  title: string;
}

/** The M3U entry the mock playlist lists; its URL carries the mock credentials. */
function m3uEntryUrl(): string {
  return `http://${mock.host}:${mock.port}/hls/${mock.m3uUser}/${mock.m3uPass}/master.m3u8`;
}

async function upsertMovie(entry: TitleEntry, durationInMinutes: number) {
  return prisma.movie.upsert({
    where: { slug: entry.slug },
    update: {
      tmdbId: entry.tmdbId,
      title: entry.title,
      durationInMinutes,
      isActive: true,
    },
    create: {
      slug: entry.slug,
      tmdbId: entry.tmdbId,
      title: entry.title,
      originalTitle: entry.title,
      synopsis: "Título de teste do E2E do MatchFlix (conteúdo CC BY da Blender Foundation).",
      releaseYear: 2008,
      ageRating: "TWELVE",
      durationInMinutes,
    },
  });
}

async function createAssociation(options: {
  tmdbId: number;
  provider: string;
  providerAssetId: string;
  playbackType: FormatSeed;
  rightsStatus: RightsSeed;
  licenseReference?: string;
}) {
  return prisma.playbackAssociation.create({
    data: {
      tmdbId: options.tmdbId,
      mediaType: "MOVIE",
      seasonNumber: 0,
      episodeNumber: 0,
      provider: options.provider,
      providerAssetId: options.providerAssetId,
      playbackType: options.playbackType,
      rightsStatus: options.rightsStatus,
      licenseReference: options.licenseReference ?? LICENSE,
    },
    select: { id: true },
  });
}

async function main() {
  const passwordHash = await hashPassword(config.admin.password);
  const admin = await prisma.user.upsert({
    where: { email: config.admin.email },
    update: { passwordHash, role: "ADMIN", name: config.admin.name },
    create: {
      email: config.admin.email,
      passwordHash,
      name: config.admin.name,
      role: "ADMIN",
    },
  });
  const profile =
    (await prisma.profile.findFirst({ where: { userId: admin.id } })) ??
    (await prisma.profile.create({ data: { userId: admin.id, name: "E2E" } }));

  // A clean slate for a re-run against the same database.
  await prisma.watchProgress.deleteMany({ where: { profileId: profile.id } });
  await prisma.playbackAssociation.deleteMany({
    where: { tmdbId: { in: Object.values(titles).map((entry) => entry.tmdbId) } },
  });

  const movies = {
    archive: await upsertMovie(titles.archive, 10),
    xtream: await upsertMovie(titles.xtream, 10),
    m3u: await upsertMovie(titles.m3u, 10),
    none: await upsertMovie(titles.none, 10),
    revoked: await upsertMovie(titles.revoked, 10),
    blocked: await upsertMovie(titles.blocked, 10),
    unverified: await upsertMovie(titles.unverified, 10),
  };

  const m3uAssetId = hashEntryUrl(m3uEntryUrl());
  const associations = {
    // Real playback straight from archive.org (no proxy).
    archive: await createAssociation({
      tmdbId: titles.archive.tmdbId,
      provider: "archive",
      providerAssetId: "BigBuckBunny_124",
      playbackType: "MP4",
      rightsStatus: "VERIFIED",
    }),
    // Credentials-in-URL MP4 behind the encrypted proxy (Range).
    xtream: await createAssociation({
      tmdbId: titles.xtream.tmdbId,
      provider: "xtream-mock",
      providerAssetId: "vod:1",
      playbackType: "MP4",
      rightsStatus: "VERIFIED",
    }),
    // Credentials-in-URL HLS behind the proxy (manifest rewrite + hls.js).
    m3u: await createAssociation({
      tmdbId: titles.m3u.tmdbId,
      provider: "m3u-mock",
      providerAssetId: m3uAssetId,
      playbackType: "HLS",
      rightsStatus: "VERIFIED",
    }),
    // Same asset as above on its own title: the test revokes it mid-playback.
    revoked: await createAssociation({
      tmdbId: titles.revoked.tmdbId,
      provider: "m3u-mock",
      providerAssetId: m3uAssetId,
      playbackType: "HLS",
      rightsStatus: "VERIFIED",
    }),
    // The server is on 127.0.0.1 but was NOT declared allowPrivateNetwork.
    blocked: await createAssociation({
      tmdbId: titles.blocked.tmdbId,
      provider: "blocked-mock",
      providerAssetId: "vod:1",
      playbackType: "MP4",
      rightsStatus: "VERIFIED",
    }),
    // A perfect match with no verified rights never plays.
    unverified: await createAssociation({
      tmdbId: titles.unverified.tmdbId,
      provider: "archive",
      providerAssetId: "BigBuckBunny_124",
      playbackType: "MP4",
      rightsStatus: "UNVERIFIED",
    }),
  };

  // Real PeerTube video, discovered now so its hosts can be allowlisted at boot.
  const discovery = await discoverPeerTubeVideo({ minSeconds: 60, maxSeconds: 900 });
  let peertube: Record<string, unknown>;

  if (discovery.ok) {
    const { pick } = discovery;
    const movie = await upsertMovie(
      titles.peertube,
      Math.max(1, Math.ceil(pick.durationSeconds / 60)),
    );
    const association = await createAssociation({
      tmdbId: titles.peertube.tmdbId,
      provider: "peertube",
      providerAssetId: pick.assetId,
      playbackType: pick.asset.type === "hls" ? "HLS" : "MP4",
      rightsStatus: "VERIFIED",
      licenseReference: `TESTE E2E — vídeo ${pick.assetId} (licença CC/domínio público declarada no PeerTube)`,
    });

    peertube = {
      found: true,
      movieId: movie.id,
      associationId: association.id,
      assetId: pick.assetId,
      title: pick.title,
      durationSeconds: pick.durationSeconds,
      type: pick.asset.type,
      allowedHosts: pick.allowedHosts,
      ...titles.peertube,
    };
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(`${OUT_DIR}/peertube-hosts.txt`, pick.allowedHosts.join(","));
    console.log(`PeerTube: ${pick.assetId} (${pick.asset.type}, ${pick.durationSeconds}s)`);
  } else {
    peertube = { found: false, reason: discovery.reason, tried: discovery.tried };
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(`${OUT_DIR}/peertube-hosts.txt`, "");
    console.log(`PeerTube: pulado — ${discovery.reason}`);
  }

  const seed = {
    admin: { id: admin.id, email: config.admin.email, password: config.admin.password },
    profileId: profile.id,
    titles: {
      archive: { ...titles.archive, movieId: movies.archive.id, associationId: associations.archive.id },
      xtream: { ...titles.xtream, movieId: movies.xtream.id, associationId: associations.xtream.id },
      m3u: { ...titles.m3u, movieId: movies.m3u.id, associationId: associations.m3u.id },
      none: { ...titles.none, movieId: movies.none.id },
      revoked: {
        ...titles.revoked,
        movieId: movies.revoked.id,
        associationId: associations.revoked.id,
      },
      blocked: {
        ...titles.blocked,
        movieId: movies.blocked.id,
        associationId: associations.blocked.id,
      },
      unverified: {
        ...titles.unverified,
        movieId: movies.unverified.id,
        associationId: associations.unverified.id,
      },
    },
    peertube,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/seed.json`, `${JSON.stringify(seed, null, 2)}\n`);
  console.log(`Seed concluído: ${OUT_DIR}/seed.json`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
