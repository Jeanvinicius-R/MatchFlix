import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Development-only fixture data. Mirrors the catalog that previously lived
 * in src/repositories/content.repository.ts, now persisted for real so the
 * repository layer can be backed by Postgres instead of an in-memory array.
 */

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL não está definida. Configure o arquivo .env.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const GENRES = [
  { name: "Drama", slug: "drama" },
  { name: "Ficção Científica", slug: "ficcao-cientifica" },
  { name: "Ação", slug: "acao" },
  { name: "Suspense", slug: "suspense" },
  { name: "Comédia", slug: "comedia" },
  { name: "Animação", slug: "animacao" },
  { name: "Documentário", slug: "documentario" },
  { name: "Fantasia", slug: "fantasia" },
] as const;

const MOVIES = [
  {
    slug: "horizonte-partido",
    title: "Horizonte Partido",
    releaseYear: 2025,
    ageRating: "FOURTEEN",
    durationInMinutes: 128,
    synopsis:
      "Um piloto exilado precisa cruzar um continente em colapso para entregar a única prova que pode evitar uma guerra.",
    genreSlugs: ["drama", "acao"],
  },
  {
    slug: "ultimo-verao-em-marer",
    title: "Último Verão em Marer",
    releaseYear: 2023,
    ageRating: "TWELVE",
    durationInMinutes: 104,
    synopsis:
      "Três irmãos retornam à casa da infância para decidir o destino da família — e o que restou dela.",
    genreSlugs: ["drama"],
  },
  {
    slug: "reino-de-vidro",
    title: "Reino de Vidro",
    releaseYear: 2021,
    ageRating: "TEN",
    durationInMinutes: 96,
    synopsis:
      "Em um reino onde tudo é feito de vidro, uma jovem artesã descobre um segredo que pode quebrar tudo.",
    genreSlugs: ["fantasia", "animacao"],
  },
  {
    slug: "sinfonia-de-ferro",
    title: "Sinfonia de Ferro",
    releaseYear: 2020,
    ageRating: "TWELVE",
    durationInMinutes: 141,
    synopsis:
      "Um maestro decadente aceita reger uma orquestra de robôs para reviver sua última obra-prima.",
    genreSlugs: ["drama", "ficcao-cientifica"],
  },
  {
    slug: "aventuras-na-ilha-encantada",
    title: "Aventuras na Ilha Encantada",
    releaseYear: 2023,
    ageRating: "L",
    durationInMinutes: 88,
    synopsis:
      "Um grupo de amigos descobre uma ilha mágica onde precisam trabalhar juntos para encontrar o caminho de casa.",
    genreSlugs: ["fantasia", "animacao"],
  },
] as const;

const SERIES = [
  {
    slug: "constelacao-negra",
    title: "Constelação Negra",
    releaseYear: 2024,
    ageRating: "SIXTEEN",
    synopsis:
      "Uma tripulação descobre um sinal impossível vindo do centro da galáxia — e nada mais faz sentido depois disso.",
    genreSlugs: ["ficcao-cientifica", "suspense"],
    seasonCount: 3,
  },
  {
    slug: "codigo-fantasma",
    title: "Código Fantasma",
    releaseYear: 2025,
    ageRating: "SIXTEEN",
    synopsis:
      "Uma analista de segurança descobre uma falha que ninguém quer que ela encontre.",
    genreSlugs: ["suspense", "acao"],
    seasonCount: 1,
  },
  {
    slug: "risadas-de-domingo",
    title: "Risadas de Domingo",
    releaseYear: 2022,
    ageRating: "L",
    synopsis:
      "A rotina caótica de uma família grande, contada em episódios de uma manhã de domingo cada.",
    genreSlugs: ["comedia"],
    seasonCount: 5,
  },
  {
    slug: "arquivos-do-abismo",
    title: "Arquivos do Abismo",
    releaseYear: 2024,
    ageRating: "FOURTEEN",
    synopsis:
      "Uma equipe de exploração documenta as criaturas nunca antes vistas nas profundezas do oceano.",
    genreSlugs: ["documentario"],
    seasonCount: 2,
  },
] as const;

async function seedGenres() {
  await Promise.all(
    GENRES.map((genre) =>
      prisma.genre.upsert({ where: { slug: genre.slug }, update: {}, create: genre }),
    ),
  );
}

async function seedMovies() {
  for (const movie of MOVIES) {
    const { genreSlugs, ...movieData } = movie;
    await prisma.movie.upsert({
      where: { slug: movie.slug },
      update: {},
      create: {
        ...movieData,
        genres: { connect: genreSlugs.map((slug) => ({ slug })) },
      },
    });
  }
}

async function seedSeries() {
  for (const series of SERIES) {
    const { genreSlugs, seasonCount, ...seriesData } = series;
    await prisma.series.upsert({
      where: { slug: series.slug },
      update: {},
      create: {
        ...seriesData,
        genres: { connect: genreSlugs.map((slug) => ({ slug })) },
        seasons: {
          create: Array.from({ length: seasonCount }, (_, index) => ({
            seasonNumber: index + 1,
          })),
        },
      },
    });
  }
}

async function main() {
  await seedGenres();
  await seedMovies();
  await seedSeries();
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
