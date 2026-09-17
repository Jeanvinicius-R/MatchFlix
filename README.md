# Aurel

Plataforma de streaming de filmes e séries — interface premium, arquitetura escalável e segura, construída de forma incremental.

> **Status:** Etapa 7 — painel administrativo implementado (`/admin`). Uploads de mídia (pôsteres/backdrops reais) e streaming real ainda não existem.

## Sumário

- [Tecnologias](#tecnologias)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Configuração (variáveis de ambiente)](#configuração-variáveis-de-ambiente)
- [Banco de dados](#banco-de-dados)
- [Autenticação](#autenticação)
- [Perfis](#perfis)
- [Comandos](#comandos)
- [Estrutura de diretórios](#estrutura-de-diretórios)
- [Decisões arquiteturais](#decisões-arquiteturais)
- [Roteiro (próximas etapas)](#roteiro-próximas-etapas)

## Tecnologias

| Camada         | Tecnologia                                                            |
| -------------- | --------------------------------------------------------------------- |
| Framework      | Next.js (App Router)                                                  |
| Linguagem      | TypeScript (strict mode)                                              |
| Estilização    | Tailwind CSS v4                                                       |
| Ícones         | lucide-react                                                          |
| Banco de dados | PostgreSQL                                                            |
| ORM            | Prisma 7 (generator `prisma-client`, saída em `src/generated/prisma`) |
| Autenticação   | Auth.js / NextAuth v5 (beta) — provider de credenciais, sessão JWT    |
| Senhas         | Argon2id (`@node-rs/argon2`)                                          |
| Validação      | Zod                                                                   |
| Formulários    | React Hook Form + `@hookform/resolvers`                               |
| Qualidade      | ESLint + Prettier (`prettier-plugin-tailwindcss`)                     |

Tecnologias planejadas para as próximas etapas (ver [Roteiro](#roteiro-próximas-etapas)): HLS.js.

## Requisitos

- Node.js 20 ou superior
- npm 10 ou superior
- Docker Desktop (para rodar o PostgreSQL local via `docker-compose.yml`) — ou uma instância PostgreSQL própria

## Instalação

```bash
npm install
```

## Configuração (variáveis de ambiente)

Copie o arquivo de exemplo e preencha os valores necessários:

```bash
cp .env.example .env
```

`DATABASE_URL` já vem preenchida com o valor correspondente ao `docker-compose.yml` (usuário/senha `aurel`, banco `aurel`, porta `5432`) — funciona sem alteração se você usar o Postgres via Docker. Gere um valor para `AUTH_SECRET` (`openssl rand -base64 32`) — sem ele, o login não funciona.

Para `TMDB_ACCESS_TOKEN`: crie uma conta gratuita em [themoviedb.org](https://www.themoviedb.org/signup), acesse **Configurações → API**, solicite uma chave (uso pessoal/educacional) e copie o **"API Read Access Token"** (o token longo, não a "API Key" curta) para o `.env`. Sem ele, `services/tmdb` lança um erro claro ao ser chamado — a Home e o resto do app funcionam normalmente sem essa variável.

## Banco de dados

O schema completo está em [`prisma/schema.prisma`](prisma/schema.prisma). Resumo das entidades e relacionamentos:

- **User → Profile** (1:N): uma conta pode ter vários perfis (estilo "quem está assistindo?").
- **Profile → WatchHistory / WatchProgress / Favorite** (1:N): histórico, progresso de reprodução e lista de favoritos pertencem ao **perfil**, não à conta — cada perfil tem sua própria experiência.
- **Movie** e **Series → Season → Episode**: hierarquia de conteúdo. Uma série tem temporadas; uma temporada tem episódios.
- **Genre ↔ Movie / Series** (N:M): um gênero se aplica a vários filmes/séries e vice-versa.
- **Media**: tabela genérica para qualquer arquivo referenciado (pôster, banner, avatar, vídeo). Guarda apenas metadados (`storageProvider`, `storageKey`, `url`) — o binário fica no storage configurado (local hoje; S3/R2/MinIO no futuro, sem mudar o schema). `Movie`, `Series`, `Season` e `Episode` referenciam `Media` por id; a tabela `Media` não sabe quem a usa.
- **WatchHistory / WatchProgress / Favorite** referenciam `Movie` **ou** `Episode`/`Series` através de colunas opcionais (`movieId`, `episodeId`, `seriesId`) — não existe uma tabela genérica de "conteúdo assistível", já que filme e episódio têm formas diferentes. Exatamente uma dessas colunas é preenchida por linha; essa regra é validada na camada de serviço (Zod), não no banco.

### Subindo o PostgreSQL local

```bash
docker compose up -d postgres
```

### Aplicando o schema (migrations)

```bash
npm run db:migrate      # cria/aplica migrations em desenvolvimento
npm run db:generate     # regenera o Prisma Client após mudanças no schema
npm run db:studio       # abre o Prisma Studio (explorador visual do banco)
```

Em produção, use `npm run db:deploy` (`prisma migrate deploy`), que só aplica migrations já commitadas — nunca gera novas.

### Populando com dados de exemplo (seed)

```bash
npm run db:seed
```

`prisma/seed.ts` cria os gêneros e um catálogo fictício de filmes/séries (o mesmo que antes vivia hardcoded em `content.repository.ts`) — é o que a Home exibe hoje. É idempotente (usa `upsert`), então rodar de novo não duplica registros.

## Autenticação

Cadastro (`/signup`), login (`/login`) e logout, usando **Auth.js v5** com um provider de credenciais (e-mail + senha) contra a tabela `User` — sem OAuth por enquanto. Sessão via JWT (cookie `httpOnly`, `sameSite=lax`, `secure` em produção); não há tabelas extras de sessão no banco.

Fluxo de camadas (mesmo padrão do restante do projeto):

```
LoginForm / SignUpForm (Client Components)
        │
        ▼
services/user.service.ts     → regras de negócio (hash, verificação, duplicidade)
        │
        ▼
repositories/user.repository.ts → Prisma (tabela User)
```

- `lib/auth.ts`: configuração do NextAuth (provider de credenciais, callbacks de `jwt`/`session`, cookie de sessão).
- `lib/password.ts`: hash e verificação com **Argon2id** (`@node-rs/argon2`, parâmetros padrão já alinhados com a recomendação da OWASP — 19 MiB, 2 iterações).
- `lib/rate-limit.ts`: limitador simples em memória (5 tentativas / 15 min por e-mail) contra força bruta no login. Como é em memória, ele reseta a cada reinício e não é compartilhado entre instâncias — se o app rodar em múltiplas instâncias no futuro, mover para um store compartilhado (Redis).
- Erros de login são sempre genéricos ("E-mail ou senha inválidos") e o tempo de resposta é equalizado com um hash "dummy" quando o e-mail não existe, para não permitir enumerar contas cadastradas.
- `passwordHash` nunca é enviado ao cliente — os `select` do Prisma nas queries de auth escolhem os campos explicitamente.
- Cadastro e login são validados com Zod tanto no client (React Hook Form) quanto de novo no server (a mesma validação do cliente é só UX; o servidor nunca confia nela).

## Perfis

Depois de logar, cada conta escolhe (ou cria) um **perfil** — até **5 por conta** — na tela "Quem está assistindo?" (`/profiles`). Favoritos, histórico e progresso de reprodução pertencerão ao perfil, não à conta, quando essas features existirem (ver [Banco de dados](#banco-de-dados)).

- **Perfil infantil** (`isKids`): ao marcar essa opção na criação, o perfil só enxerga conteúdo com classificação `L` (livre para todos os públicos) — filtro aplicado em `content.repository.ts`, nunca no client.
- Só existe **um perfil ativo por vez**, guardado num cookie próprio (`active_profile_id`, `httpOnly`), separado do cookie de sessão do NextAuth — trocar de perfil não exige logar de novo. A propriedade do perfil é sempre reconferida no servidor a cada leitura (`profile.service.ts`); um cookie forjado ou de outra conta é descartado silenciosamente.
- Se a conta tiver só 1 perfil, a tela de seleção é pulada automaticamente.
- Se um usuário logado tentar acessar a Home sem um perfil ativo válido, é redirecionado para `/profiles`.
- Selecionar um perfil é uma rota (`GET /profiles/select/[profileId]`), não uma Server Action — gravar cookie só é permitido em Server Actions/Route Handlers, nunca durante a renderização de uma página, e essa rota precisa ser alcançável tanto por clique quanto por redirecionamento automático (perfil único).

**Fora de escopo nesta etapa, de propósito:** editar/renomear e excluir perfis, upload de avatar (usa iniciais + cor por enquanto) e proteção do futuro painel administrativo.

## Comandos

| Comando                | Descrição                                      |
| ---------------------- | ---------------------------------------------- |
| `npm run dev`          | Inicia o servidor de desenvolvimento           |
| `npm run build`        | Gera o build de produção                       |
| `npm run start`        | Sobe o build de produção                       |
| `npm run lint`         | Executa o ESLint                               |
| `npm run typecheck`    | Verifica os tipos com `tsc --noEmit`           |
| `npm run format`       | Formata o projeto com Prettier                 |
| `npm run format:check` | Verifica a formatação sem alterar arquivos     |
| `npm run db:migrate`   | Cria e aplica migrations em desenvolvimento    |
| `npm run db:generate`  | Regenera o Prisma Client a partir do schema    |
| `npm run db:deploy`    | Aplica migrations existentes (uso em produção) |
| `npm run db:studio`    | Abre o Prisma Studio                           |
| `npm run db:seed`      | Popula o banco com dados de exemplo            |

## Estrutura de diretórios

```
prisma/
  schema.prisma         Modelo de dados (fonte da verdade do banco)
  migrations/           Histórico de migrations (gerado pelo Prisma)
  seed.ts               Dados de exemplo para desenvolvimento

src/
  app/
    (auth)/             Grupo de rotas de /login e /signup (layout centralizado próprio)
    api/auth/           Rota catch-all do NextAuth
    api/tmdb/           Rotas internas de consulta à TMDB (search, movie/[id], series/[id]) — role ADMIN
    admin/              Painel administrativo (/admin/movies, /series, /genres) — protegido por requireAdmin()
    profiles/           Seleção/criação de perfil (/profiles, /profiles/new, /profiles/select/[id])
    ...                 Demais rotas do App Router
  components/
    ui/                 Componentes de UI genéricos e reutilizáveis (Button, Input, Select, Textarea, ...)
    layout/             Componentes estruturais (Header, Logo, busca)
  features/
    home/               Componentes específicos da Home (hero, carrosséis, cards)
    auth/               Formulários de login/cadastro e ações do header (entrar/sair)
    profiles/           Avatar, grade de seleção e formulário de novo perfil
    admin/              Formulários e componentes do painel (MovieForm, SeriesForm, GenreManager, TmdbSearchPicker, ...)
  services/             Regras de negócio; ponto único de acesso a dados para a UI
    movie.service.ts, series.service.ts, genre.service.ts  Regras do painel administrativo (slug, gêneros, import TMDB)
  repositories/
    content.repository.ts  Consultas Prisma para filmes/séries (leitura pública)
    content.mapper.ts      Converte os modelos do Prisma para os tipos de domínio (ContentSummary)
    user.repository.ts     Consultas Prisma para usuários (auth)
    profile.repository.ts  Consultas Prisma para perfis
    movie.repository.ts, series.repository.ts, genre.repository.ts  Escrita administrativa (CRUD do painel)
  lib/
    utils.ts            cn() (clsx + tailwind-merge)
    prisma.ts           Instância única do Prisma Client
    auth.ts             Configuração do NextAuth (provider de credenciais, callbacks)
    password.ts         Hash/verificação de senha (Argon2id)
    rate-limit.ts        Limitador de tentativas em memória (login)
    active-profile-cookie.ts  Leitura/escrita do cookie de perfil ativo
    require-admin.ts    Guarda de sessão/role para o painel administrativo
  utils/                Funções utilitárias puras, sem dependência de framework (inclui slug.utils.ts, age-rating.utils.ts)
  types/                Tipos e interfaces de domínio compartilhados
  schemas/              Esquemas de validação Zod (auth, profile, movie, series, genre)
  hooks/                Hooks React reutilizáveis entre features (ainda vazio)
  config/               Configuração da aplicação (ex.: metadados do site)
  constants/            Valores fixos (ex.: itens de navegação)
  generated/prisma/     Prisma Client gerado — não editar, não versionar
```

**Regra de dependência:** componentes (`components/`, `features/`) chamam `services/`; `services/` chamam `repositories/`; apenas `repositories/` sabe de onde os dados vêm (hoje, Prisma/Postgres; futuramente, também TMDB). Isso mantém a UI desacoplada da origem dos dados. O `content.mapper.ts` garante que o restante da aplicação nunca dependa diretamente do formato dos modelos do Prisma (mesmo princípio já registrado para a futura integração TMDB).

## Decisões arquiteturais

### Camadas e fluxo de dados

```
Componente (Server/Client Component)
        │
        ▼
   services/*.service.ts   → regras de negócio
        │
        ▼
 repositories/*.repository.ts → acesso a dados (Prisma → PostgreSQL)
        │
        ▼
   repositories/*.mapper.ts → converte o modelo do Prisma para o tipo de domínio
```

Os componentes nunca acessam repositórios diretamente, e regras de negócio não ficam dentro de componentes React — eles cuidam apenas de apresentação e interação.

### Metadados de catálogo via TMDB

A plataforma usa a **API do TMDB (The Movie Database)** como fonte externa de metadados de filmes e séries: título, sinopse, pôsteres, backdrops, gêneros, datas de lançamento, duração, classificação (BR), temporadas e episódios.

**Os arquivos de vídeo em si não vêm da TMDB.** O streaming é tratado separadamente, com arquivos próprios/autorizados, futuramente via HTTP Range Requests e HLS.

Fluxo:

```
Cliente (browser)
   │
   ▼
GET /api/tmdb/search (Route Handler — verifica role: ADMIN)
   │
   ▼
services/tmdb/tmdb.service.ts   → pesquisar/obter detalhes
   │
   ▼
services/tmdb/tmdb.client.ts    → requisição HTTP autenticada
   │
   ▼
TMDB API
   │
   ▼
services/tmdb/tmdb.mapper.ts    → converte para o modelo interno
```

`src/services/tmdb/`:

| Arquivo           | Responsabilidade                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tmdb.client.ts`  | Comunicação HTTP com a API do TMDB (`fetch` com Bearer token, base de URLs de imagem, cache de 24h)                                                                                         |
| `tmdb.service.ts` | Operações de negócio: `searchMovies`, `searchSeries`, `getMovieDetails`, `getSeriesDetails`, `getSeasonDetails`, `getMovieGenres`, `getSeriesGenres`                                        |
| `tmdb.types.ts`   | Tipos das respostas externas da TMDB (`*Raw`) **e** dos tipos internos que `tmdb.mapper.ts` produz                                                                                          |
| `tmdb.mapper.ts`  | Converte os dados da TMDB para o modelo interno da aplicação — inclui extrair a classificação indicativa brasileira (`release_dates`/`content_ratings` filtrados por `iso_3166_1 === "BR"`) |

Regras seguidas na implementação:

- A aplicação **nunca** depende diretamente da estrutura dos objetos da TMDB — todo dado externo passa por `tmdb.mapper.ts` antes de chegar ao restante do sistema. Isso permite trocar de fornecedor de metadados no futuro sem reescrever o sistema; só `tmdb.mapper.ts` precisaria mudar.
- O token (`TMDB_ACCESS_TOKEN`) é lido apenas em `tmdb.client.ts` (server-side) e **nunca** é prefixado com `NEXT_PUBLIC_`, portanto nunca chega ao navegador.
- Componentes de UI nunca chamam a TMDB diretamente; a única porta de entrada hoje é `GET /api/tmdb/search`, protegida por `role: ADMIN` (ainda não há painel administrativo, mas a rota já está pronta pra ele consumir).
- Como ainda não existe nenhum usuário `ADMIN`, promova um usuário manualmente para testar: `UPDATE "User" SET role = 'ADMIN' WHERE email = 'seu-email@exemplo.com';` (via `npm run db:studio` ou `psql`).

**Fora de escopo nesta etapa, de propósito:** usar esses dados para de fato criar/atualizar registros de `Movie`/`Series` no banco — isso é trabalho do painel administrativo (etapa seguinte), que vai chamar `services/tmdb` para pré-preencher o formulário de cadastro.

### Painel administrativo

Em `/admin` (protegido por `requireAdmin()` em `lib/require-admin.ts`, que redireciona pra `/login` sem sessão e pra `/` quando `role !== "ADMIN"` — checado tanto no `layout.tsx` quanto em cada Server Action, já que uma Action é invocável diretamente). CRUD completo de **filmes**, **séries** (com temporadas/episódios) e **gêneros**:

- **Filmes e séries** podem ser criados manualmente ou a partir de uma busca na TMDB (`TmdbSearchPicker`, reaproveitando `GET /api/tmdb/search`) — ao escolher um resultado, o formulário é pré-preenchido via duas rotas novas (`GET /api/tmdb/movie/[tmdbId]`, `GET /api/tmdb/series/[tmdbId]`), com os mesmos dados que `services/tmdb` já expõe.
- **Ao criar uma série a partir da TMDB, todas as temporadas e episódios são importados automaticamente** numa única Server Action (`createSeriesAction` → `series.service.ts`), buscando cada temporada sequencialmente na TMDB antes de persistir tudo de uma vez (`series.repository.ts`, uma única `prisma.series.create` com `seasons`/`episodes` aninhados).
- **"Excluir" é desativar**: filmes e séries usam a coluna `isActive` que já existia no schema (mesma usada pelo filtro público em `content.repository.ts`) — não há hard delete. Gênero é exclusão de verdade (M:N implícito do Prisma, sem risco de cascade).
- Gêneros vindos da TMDB ou digitados manualmente são resolvidos por `upsertGenresByName` (`genre.service.ts`), que faz upsert por slug — duas grafias do mesmo gênero (ex.: "Ficção Científica" vs "ficção científica") colapsam num único registro.
- Slugs são gerados automaticamente na criação (`slug.utils.ts`, com sufixo numérico em caso de colisão) e ficam editáveis na edição, com validação de unicidade.

**Fora de escopo nesta etapa, de propósito:** pôsteres/backdrops (a `Media` associada só existe a partir da Etapa 8, com upload real); reimportar ou editar temporadas/episódios depois que a série já foi criada (o painel não guarda o id da TMDB, então a única forma de popular temporadas é na criação); adicionar temporadas manualmente a uma série criada sem TMDB.

## Roteiro (próximas etapas)

1. ~~Arquitetura, organização e protótipo de interface (mock data)~~
2. ~~Modelagem e migration inicial do banco de dados (PostgreSQL + Prisma)~~
3. ~~Home consumindo dados reais (`content.repository.ts` → Prisma → PostgreSQL)~~
4. ~~Autenticação de usuários — cadastro, login, sessão, logout (Auth.js + Argon2)~~
5. ~~Perfis por conta — criação (até 5), seleção de "quem está assistindo", perfil infantil restringindo o catálogo~~
6. ~~Integração com a TMDB (`services/tmdb` + `GET /api/tmdb/search`)~~
7. ~~Painel administrativo (cadastro de filmes, séries, temporadas, episódios e gêneros) — protegido por `role: ADMIN`, consumindo `services/tmdb` pra pré-preencher o cadastro~~ ← etapa atual
8. Uploads de mídia (capas, banners, avatars) com abstração de storage
9. Streaming real (Range Requests / HLS)
10. Favoritos, histórico e progresso de reprodução (por perfil)
