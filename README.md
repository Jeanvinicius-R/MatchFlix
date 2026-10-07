# MatchFlix

Plataforma de streaming de filmes e séries — interface premium, arquitetura escalável e segura, construída de forma incremental.

> **Status atual:** catálogo com metadados da TMDB, painel administrativo, perfis, "Minha lista", progresso de reprodução com "Continuar assistindo", "Onde assistir" (TMDB/JustWatch) e reprodução por duas vias: arquivos de vídeo vinculados pelo painel (player próprio) e um `PlaybackResolver` com providers (fonte autorizada, Internet Archive curado e YouTube com canais permitidos). Ainda **não** existe upload de mídia, transcodificação/HLS próprio nem tela de histórico — ver [Roteiro](#roteiro).

## Sumário

- [Tecnologias](#tecnologias)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Configuração (variáveis de ambiente)](#configuração-variáveis-de-ambiente)
- [Banco de dados](#banco-de-dados)
- [Autenticação](#autenticação)
- [Perfis](#perfis)
- [Catálogo e TMDB](#catálogo-e-tmdb)
- [Painel administrativo](#painel-administrativo)
- ["Onde assistir" × Playback](#onde-assistir--playback)
- [Arquitetura de playback](#arquitetura-de-playback)
- [Fontes legais / autorizadas](#fontes-legais--autorizadas)
- [Minha lista, progresso e histórico](#minha-lista-progresso-e-histórico)
- [Comandos](#comandos)
- [Deploy](#deploy)
- [Estrutura de diretórios](#estrutura-de-diretórios)
- [Decisões arquiteturais](#decisões-arquiteturais)
- [Roteiro](#roteiro)

## Tecnologias

| Camada         | Tecnologia                                                                                |
| -------------- | ----------------------------------------------------------------------------------------- |
| Framework      | Next.js 16 (App Router, Turbopack)                                                        |
| Linguagem      | TypeScript (strict mode)                                                                  |
| Estilização    | Tailwind CSS v4                                                                           |
| Ícones         | lucide-react                                                                              |
| Banco de dados | PostgreSQL (Neon em uso; Postgres local via Docker opcional)                              |
| ORM            | Prisma 7 (generator `prisma-client`, saída em `src/generated/prisma`) com driver adapters |
| Autenticação   | Auth.js / NextAuth v5 (beta) — provider de credenciais, sessão JWT                        |
| Senhas         | Argon2id (`@node-rs/argon2`)                                                              |
| Validação      | Zod                                                                                       |
| Formulários    | React Hook Form + `@hookform/resolvers`                                                   |
| Metadados      | API da TMDB (The Movie Database)                                                          |
| Qualidade      | ESLint + Prettier (`prettier-plugin-tailwindcss`)                                         |

## Requisitos

- Node.js 20 ou superior
- npm 10 ou superior
- Um banco PostgreSQL: o projeto usa o **Neon**; como alternativa, Docker Desktop para o serviço `postgres` do `docker-compose.yml`

## Instalação

```bash
npm install            # instala dependências e roda `prisma generate` (postinstall)
cp .env.example .env   # cria seu .env a partir do modelo
npm run dev            # http://localhost:3000
```

Antes de subir o servidor, preencha o `.env` ([variáveis](#configuração-variáveis-de-ambiente)) e, se o banco for novo/vazio, aplique as migrations ([Comandos do Prisma](#comandos-do-prisma)).

O `.env.example` é o modelo versionado, sem valores reais. O `.env` é a sua cópia local com as chaves de verdade e **nunca** é commitado (está no `.gitignore`).

## Configuração (variáveis de ambiente)

Só `NEXT_PUBLIC_APP_NAME` chega ao navegador. Todas as outras são lidas apenas no servidor — nunca adicione o prefixo `NEXT_PUBLIC_` a elas.

| Variável                       | Obrigatória | Para quê                                                                                                                                                                             |
| ------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                 | Sim         | Conexão Postgres. No Neon, use a "Connection string" (`postgresql://…`) do painel — **não** a URL da REST/Data API.                                                                  |
| `DATABASE_DRIVER`              | Não         | `"neon-ws"` conecta ao Neon por WebSocket (porta 443). Use em redes que bloqueiam a porta 5432 (ex.: rede da escola). Usa o WebSocket nativo do Node (22+). Vazio = Postgres normal. |
| `AUTH_SECRET`                  | Sim         | Segredo do Auth.js (`openssl rand -base64 32`). Trocar o valor desloga todo mundo.                                                                                                   |
| `AUTH_TRUST_HOST`              | Produção    | `true` ao rodar o build de produção, atrás de proxy ou acessando por IP/domínio — sem isso o login falha com `UntrustedHost`.                                                        |
| `NEXT_PUBLIC_APP_NAME`         | Não         | Nome público do site.                                                                                                                                                                |
| `TMDB_ACCESS_TOKEN`            | Recomendado | "API Read Access Token" (o token longo) da TMDB. Sem ele, busca/import no `/admin`, "Onde assistir" e os metadados usados pelo YouTube falham.                                       |
| `MEDIA_LIBRARY_DIR`            | Não         | Pasta com seus próprios arquivos de vídeo ("Meus arquivos"). Padrão: `./movies`.                                                                                                     |
| `PLAYBACK_AUTHORIZED_BASE_URL` | Não         | Base de uma fonte de vídeo que **você** tem autorização para usar. Vazio = provider desativado.                                                                                      |
| `PLAYBACK_PROVIDER_BASE_URL`   | Não         | Base do provider `example` (infraestrutura de exemplo). Deixe **vazio** — ver [Fontes legais](#fontes-legais--autorizadas).                                                          |
| `YOUTUBE_API_KEY`              | Não         | Chave de API de um projeto do Google Cloud com a YouTube Data API v3 ativada.                                                                                                        |
| `YOUTUBE_ALLOWED_CHANNEL_IDS`  | Não         | Allowlist de IDs de canal (`UC…`), separados por vírgula, dos quais o provider do YouTube aceita vídeos.                                                                             |

**TMDB:** crie uma conta em [themoviedb.org](https://www.themoviedb.org/signup), vá em **Configurações → API** e copie o **"API Read Access Token"** (não a "API Key" curta).

## Banco de dados

O schema completo está em [`prisma/schema.prisma`](prisma/schema.prisma). Resumo:

- **User → Profile** (1:N): uma conta tem até 5 perfis.
- **Profile → WatchHistory / WatchProgress / Favorite** (1:N): histórico, progresso e lista pertencem ao **perfil**, não à conta.
- **Movie** e **Series → Season → Episode**: hierarquia de conteúdo. `Movie` e `Series` têm `tmdbId` (opcional, único) ligando o registro à TMDB.
- **Genre ↔ Movie / Series** (N:M).
- **Media**: metadados de qualquer arquivo referenciado (pôster, backdrop, vídeo) — `storageProvider`, `storageKey`, `url`, `mimeType`, tamanho, duração. O binário fica fora do banco. Valores de `StorageProvider`: `LOCAL`, `S3`, `R2`, `MINIO`, `INTERNET_ARCHIVE`, `WIKIMEDIA_COMMONS`, `TMDB` (pôsteres/backdrops apontam para a CDN da TMDB). `S3`, `R2` e `MINIO` existem no enum, mas ainda não há implementação.
- **WatchHistory / WatchProgress / Favorite** referenciam `Movie` **ou** `Episode`/`Series` por colunas opcionais; a regra "exatamente uma preenchida" é validada na camada de serviço (Zod).

### Comandos do Prisma

```bash
npm run db:migrate      # cria/aplica migrations em desenvolvimento (gera novas a partir do schema)
npm run db:deploy       # aplica migrations já commitadas, sem gerar novas (produção/Neon)
npm run db:generate     # regenera o Prisma Client após mudar o schema
npm run db:studio       # explorador visual do banco
npm run db:seed         # dados fictícios (ver Seed abaixo)
```

Migrations existentes: `init`, `add_profile_is_kids`, `add_internet_archive_storage_provider`, `add_wikimedia_commons_storage_provider`, `add_tmdb_storage_provider`, `add_tmdb_ids`.

> O Prisma CLI (`migrate`, `studio`) conecta pela porta 5432. Em redes que bloqueiam essa porta, `DATABASE_DRIVER="neon-ws"` resolve a **aplicação**, mas não o CLI — rode migrations de outra rede.

### Postgres local (opcional)

```bash
docker compose up -d postgres
```

O `DATABASE_URL` do `.env.example` já corresponde a esse serviço (usuário/senha/banco `aurel`, porta `5432`).

### Seed

`prisma/seed.ts` cria gêneros e um catálogo **fictício** de filmes/séries (sem `tmdbId`), só para desenvolvimento. É idempotente (`upsert`). Esses títulos não têm metadados nem fontes na TMDB — para um catálogo real, importe pelo painel.

## Autenticação

Cadastro (`/signup`), login (`/login`) e logout com **Auth.js v5** e provider de credenciais (e-mail + senha) — sem OAuth. Sessão via JWT (cookie `httpOnly`, `sameSite=lax`, `secure` em produção).

```
LoginForm / SignUpForm (Client Components)
        │
        ▼
services/user.service.ts        → regras de negócio (hash, verificação, duplicidade)
        │
        ▼
repositories/user.repository.ts → Prisma (tabela User)
```

- `lib/password.ts`: **Argon2id** (`@node-rs/argon2`, parâmetros alinhados à OWASP).
- `lib/rate-limit.ts`: limitador em memória (5 tentativas / 15 min por e-mail). Reseta a cada reinício e não é compartilhado entre instâncias.
- Erros de login são genéricos e o tempo de resposta é equalizado, para não permitir enumerar contas.
- `passwordHash` nunca vai ao cliente.
- Validação Zod no client (UX) **e** no server.
- **Configurações da conta** (`/settings`): alterar nome, e-mail e senha, e escolher tema claro/escuro.

## Perfis

Até **5 perfis por conta**, escolhidos em "Quem está assistindo?" (`/profiles`).

- **Perfil infantil** (`isKids`): só enxerga conteúdo com classificação `L`. O filtro é aplicado no servidor (repositórios/serviços), inclusive nas páginas de reprodução.
- Perfil ativo guardado num cookie próprio (`active_profile_id`, `httpOnly`); a propriedade do perfil é reconferida no servidor a cada leitura.
- Conta com 1 perfil pula a tela de seleção.

**Ainda não existe:** editar/renomear/excluir perfis e upload de avatar (usa iniciais + cor).

## Catálogo e TMDB

A **API da TMDB** é a fonte de metadados: título, título original, sinopse, pôster, backdrop, gêneros, ano, duração, classificação indicativa brasileira, temporadas e episódios. **A TMDB não fornece vídeo.**

```
Painel /admin ──► GET /api/tmdb/search | /api/tmdb/movie/[id] | /api/tmdb/series/[id]  (role ADMIN)
                         │
                         ▼
               services/tmdb/tmdb.service.ts   → operações de negócio
                         │
                         ▼
               services/tmdb/tmdb.client.ts    → fetch autenticado (Bearer), cache de 24h
                         │
                         ▼
               services/tmdb/tmdb.mapper.ts    → converte para o modelo interno
```

| Arquivo           | Responsabilidade                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tmdb.client.ts`  | HTTP com a TMDB (Bearer token, base de URLs de imagem, cache de 24h). Único lugar que lê `TMDB_ACCESS_TOKEN`.                                                                       |
| `tmdb.service.ts` | `searchMovies`, `searchSeries`, `getMovieDetails`, `getSeriesDetails`, `getSeasonDetails`, `getMovieGenres`, `getSeriesGenres`, `getMovieWatchProviders`, `getSeriesWatchProviders` |
| `tmdb.types.ts`   | Tipos das respostas da TMDB (`*Raw`) e dos tipos internos                                                                                                                           |
| `tmdb.mapper.ts`  | Converte para o modelo interno — inclui a classificação brasileira (`release_dates`/`content_ratings` com `iso_3166_1 === "BR"`) e os watch providers da região BR                  |

O restante do app nunca depende do formato da TMDB: tudo passa por `tmdb.mapper.ts`. A busca pública do site (`/search`) consulta o **banco**, não a TMDB.

### Atribuição TMDB / JustWatch

- **TMDB:** a página `/about` ("Sobre / Créditos", linkada no rodapé) exibe o logo oficial e o aviso _"This product uses the TMDB API but is not endorsed or certified by TMDB."_, como exigem os Termos de Uso da API.
- **JustWatch:** a seção "Onde assistir" termina com _"Dados de disponibilidade de streaming fornecidos por JustWatch."_, já que a TMDB repassa esses dados da JustWatch.

## Painel administrativo

Em `/admin`, protegido por `requireAdmin()` (`lib/require-admin.ts`) no `layout.tsx` **e** em cada Server Action. Para ter um admin, promova um usuário manualmente:

```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = 'seu-email@exemplo.com';
```

O que o painel faz hoje:

- **Filmes e séries**: criar manualmente ou a partir de uma busca na TMDB (`TmdbSearchPicker`), que pré-preenche o formulário e grava o `tmdbId`. Na criação via TMDB, pôster e backdrop são buscados automaticamente (melhor esforço — uma falha da TMDB não impede o cadastro).
- **Séries via TMDB**: as temporadas escolhidas e seus episódios são importados na criação, numa única gravação.
- **Editar**: dados do título, slug (com validação de unicidade) e `tmdbId` — vincular um título já existente à TMDB habilita "Onde assistir" e o `PlaybackResolver` para ele.
- **Imagens**: aplicar pôster/backdrop da TMDB a um título existente. As URLs são relidas da TMDB no servidor — o cliente só envia o id.
- **Vídeo**: vincular um arquivo a um filme, ou arquivos a episódios de uma série, escolhendo entre **Meus arquivos**, **Internet Archive** e **Wikimedia Commons** (`VideoSourcePicker`, via `/api/video-sources/*`, role ADMIN). A URL do arquivo é reconstruída no servidor a partir da listagem da própria fonte.
- **Vincular pasta**: liga automaticamente arquivos de `MEDIA_LIBRARY_DIR` a filmes sem vídeo, exigindo no nome do arquivo o **ano** e todas as palavras significativas do título (ex.: `Título (Ano).mp4`). Casos ambíguos são deixados de lado e listados num relatório.
- **Excluir = desativar** (`isActive`) para filmes e séries; gêneros são excluídos de fato. Gêneros são unificados por slug (`upsertGenresByName`).

**Limitações atuais:** depois que a série é criada, não dá para reimportar ou adicionar temporadas/episódios (nem pela TMDB, nem manualmente); a edição é só no nível da série.

## "Onde assistir" × Playback

São duas coisas **diferentes** e o código as mantém separadas:

|           | "Onde assistir"                                                                                | Playback                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| O que é   | Vitrine de opções legais de streaming (assinatura, grátis, anúncios, aluguel, compra)          | O vídeo que toca dentro do MatchFlix                                                       |
| Fonte     | TMDB Watch Providers (dados da JustWatch), região **BR**                                       | Arquivo vinculado no painel **ou** `PlaybackResolver` (providers)                          |
| Código    | `features/watch/components/WhereToWatch.tsx`                                                   | `components/playback/*`, `features/watch/components/WatchPlayer.tsx`, `services/playback/` |
| Links     | Apenas o link agregador da TMDB para o título/país — nunca uma URL de serviço montada pelo app | URLs de embed/arquivo geradas no servidor                                                  |
| Sem dados | A seção não aparece                                                                            | Aviso "Nenhuma fonte disponível" / "ainda não está disponível"                             |

"Onde assistir" **nunca** é usado como fonte de reprodução. Ele aparece nas páginas `/watch/[slug]` e `/watch/series/[slug]` quando o título tem `tmdbId`.

## Arquitetura de playback

Ao abrir um título, a página escolhe **uma** destas vias, nesta ordem:

```
/watch/[slug]  (filme)  ou  /watch/series/[slug]?e=<episódio>
        │
        ├─ 1. Título/episódio tem vídeo vinculado (Media)?
        │        └─► WatchPlayer  — <video> nativo; salva progresso e histórico
        │
        ├─ 2. Senão, o título tem tmdbId?
        │        └─► MoviePlayback / EpisodePlayback (client)
        │                 │  fetch
        │                 ▼
        │           GET /api/playback/movie/[tmdbId]
        │           GET /api/playback/tv/[tmdbId]/[season]/[episode]   (exige login)
        │                 │
        │                 ▼
        │           services/playback/index.ts  → adiciona metadados da TMDB ao contexto
        │                 │
        │                 ▼
        │           PlaybackResolver → providers em paralelo (timeout de 5 s cada)
        │                 │
        │                 ▼
        │           PlaybackPlayer — renderiza a fonte escolhida
        │
        └─ 3. Nenhum dos dois → MissingVideoNotice (admin vê o atalho "Vincular vídeo")
```

### PlaybackResolver (`services/playback/playback.resolver.ts`)

- Executa todos os providers em paralelo com `Promise.allSettled`.
- Cada provider tem **5 s**; quem falha, lança erro ou estoura o tempo é registrado no log e ignorado — nunca esconde as fontes dos outros. (O timeout só para de esperar; não cancela a requisição em andamento.)
- Devolve a lista de `PlaybackSource` (`id`, `provider`, `type`, `url`, `label`, `quality?`). A primeira é selecionada; com mais de uma, aparecem botões para trocar.
- Antes de resolver, `services/playback/index.ts` busca título, título original, ano, título do episódio e duração na TMDB. Se a TMDB falhar, o contexto segue só com os ids.

Providers registrados (`services/playback/index.ts`):

| Provider           | Arquivo                        | Ativo quando                                      | Tipo   | Filmes | Episódios |
| ------------------ | ------------------------------ | ------------------------------------------------- | ------ | ------ | --------- |
| `authorized`       | `authorized.provider.ts`       | `PLAYBACK_AUTHORIZED_BASE_URL` (http/https)       | iframe | ✔      | ✔         |
| `example`          | `example.provider.ts`          | `PLAYBACK_PROVIDER_BASE_URL`                      | iframe | ✔      | ✔         |
| `internet-archive` | `internet-archive.provider.ts` | Sempre (lista curada no código)                   | iframe | ✔      | —         |
| `youtube`          | `youtube.provider.ts`          | `YOUTUBE_API_KEY` + `YOUTUBE_ALLOWED_CHANNEL_IDS` | iframe | ✔      | ✔         |

- **authorized**: só monta URLs — `${BASE}/movie/<tmdbId>` e `${BASE}/tv/<tmdbId>/<temporada>/<episódio>`. Não faz requisições nem buscas; rejeita protocolos que não sejam http(s).
- **example**: apenas **infraestrutura de exemplo** de como um provider por URL funciona (`${BASE}/embed/movie/<tmdbId>` e `${BASE}/embed/tv/<tmdbId>/<temporada>/<episódio>`). Não valida o protocolo da URL. `PLAYBACK_PROVIDER_BASE_URL` deve permanecer **vazio** enquanto não houver uma fonte autorizada — para uma fonte real, use o `authorized`.
- **internet-archive**: mapa curado `tmdbId → identificador do item` no próprio arquivo, gerando embeds `https://archive.org/embed/<item>`. Nunca pesquisa o Archive. Hoje tem **uma** entrada: _His Girl Friday_ (1940, domínio público, TMDB `3085`). Não cobre episódios.
- **youtube**: ver abaixo.

### PlaybackPlayer (`components/playback/PlaybackPlayer.tsx`)

| `type`     | Comportamento                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `iframe`   | `<iframe>` com `allowFullScreen`. Referrer `strict-origin-when-cross-origin` só para o YouTube (exigência do embed); `no-referrer` para os demais. |
| `direct`   | `<video>` nativo.                                                                                                                                  |
| `hls`      | Só onde o navegador toca HLS nativamente (Safari/iOS). Nos demais, mostra um aviso — **hls.js não está instalado**.                                |
| `external` | Botão "Assistir no serviço" abrindo em nova aba.                                                                                                   |

Tem botão próprio de tela cheia (no contêiner, independente do provider). Hoje todos os providers retornam `iframe`; `direct`, `hls` e `external` já são suportados pelo player, mas nenhum provider os usa.

### WatchPlayer (`features/watch/components/WatchPlayer.tsx`)

Player `<video>` para arquivos vinculados no painel (Meus arquivos, Internet Archive, Wikimedia Commons). Retoma de onde parou, salva progresso a cada 10 s, ao pausar e ao esconder a aba, registra o início no histórico e, em séries, avança para o próximo episódio ao terminar. Arquivos de "Meus arquivos" são servidos por `GET /api/library/[...path]` (exige login, com HTTP Range para permitir avançar/voltar, caminho confinado à pasta).

### YouTube provider

`services/playback/providers/youtube.provider.ts` usa **só** a YouTube Data API v3 oficial (`search.list` + `videos.list`) e o player de embed oficial — sem scraping e sem URLs de stream.

O provider só funciona com as duas variáveis do YouTube preenchidas ([Configuração](#configuração-variáveis-de-ambiente)). Com a chave **ou** a allowlist vazia, fica **desativado** e não faz nenhuma chamada ao YouTube. Entradas da allowlist fora do formato de ID de canal são descartadas.

Um vídeo só vira fonte se passar em **todas** as checagens:

- o canal está em `YOUTUBE_ALLOWED_CHANNEL_IDS`;
- `embeddable`, público, processado e não é transmissão ao vivo;
- disponível na região **BR**;
- o título do vídeo menciona o nome do filme/série (pt-BR ou original); em episódios, também o título do episódio ou um marcador como `S01E02`, `T1 E2`, `1x02`, "temporada 1 episódio 2";
- duração de pelo menos **75%** da duração da TMDB (sem duração na TMDB: mínimo de 40 min para filme e 10 min para episódio) — para descartar trailers e clipes.

O primeiro candidato aprovado, na ordem de relevância da busca, vence.

#### Limitações atuais do YouTube

- **Não verifica direitos autorais.** `embeddable` só diz que quem publicou permite incorporar o vídeo, e `licensedContent` só diz que o canal tem vínculo com um parceiro de conteúdo — **nenhum dos dois comprova licença**. A allowlist é uma **decisão administrativa** de quem opera o site, não uma checagem automática. Liste só canais que você verificou terem os direitos dos títulos completos — a maioria dos canais "oficiais" publica apenas trailers.
- **Cota:** cada busca gasta no máximo 1 `search.list` + 1 `videos.list`. O `search.list` é caro na cota diária da API (cerca de 100 buscas/dia na cota padrão). As respostas ficam em cache por 24 h.
- **Casamento heurístico:** depende do nome e da duração; pode não achar um vídeo existente ou, em canais com títulos ambíguos, escolher o vídeo errado.
- Com mais de um canal permitido, a busca não é restrita a um canal (a API aceita só um `channelId`); os resultados são filtrados depois, entre os 10 primeiros.
- Depende da TMDB: sem `TMDB_ACCESS_TOKEN` (ou com a TMDB fora do ar) não há título para buscar, e o provider não retorna nada.
- Como é um iframe, **não salva progresso nem histórico** (ver abaixo).

## Fontes legais / autorizadas

O MatchFlix só deve reproduzir conteúdo que você tem direito de exibir:

- **Meus arquivos** (`MEDIA_LIBRARY_DIR`): seus próprios arquivos.
- **Internet Archive** e **Wikimedia Commons**: escolha apenas itens em domínio público ou com licença aberta. O provider curado do Internet Archive só deve receber títulos verificados.
- **Fonte autorizada** (`PLAYBACK_AUTHORIZED_BASE_URL`): um serviço com o qual você tem autorização de uso.
- **YouTube**: apenas canais que você verificou terem os direitos (ver limitações acima).
- **`PLAYBACK_PROVIDER_BASE_URL` (provider `example`)**: só infraestrutura de exemplo. Mantenha vazio; nunca aponte para serviços sem licença.
- **"Onde assistir"** apenas informa e linka para a TMDB/JustWatch — não reproduz nada.

## Minha lista, progresso e histórico

| Recurso              | Estado                                                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Minha lista          | ✔ Favoritos: botão nas páginas de reprodução; página `/my-list`. Por perfil, respeitando o perfil infantil.                                                                 |
| Progresso            | ✔ Só para **arquivos vinculados** (tocados pelo `WatchPlayer`). Conta como assistido a partir de 95%. Séries retomam no episódio certo e marcam "em andamento"/"assistido". |
| Continuar assistindo | ✔ Fileira na Home com títulos não terminados (uma entrada por série), a partir do progresso acima.                                                                          |
| Histórico (gravação) | ✔ Só para **arquivos vinculados**: o `WatchPlayer` grava em `WatchHistory` o início de cada reprodução.                                                                     |
| Histórico (tela)     | ✘ `WatchHistory` existe no banco, mas **ainda não há tela de histórico**.                                                                                                   |
| Fontes via iframe    | ✘ Reproduções pelo `PlaybackResolver` (YouTube, Archive curado, fonte autorizada, example) **não** salvam progresso nem histórico — o iframe não expõe o tempo do vídeo.    |

Outras telas: Home (destaque + fileiras), `/movies`, `/series`, `/search` (busca no banco por título/título original), `/settings`, `/about`.

## Comandos

| Comando                | Descrição                |
| ---------------------- | ------------------------ |
| `npm run build`        | Build de produção        |
| `npm run start`        | Sobe o build de produção |
| `npm run lint`         | ESLint                   |
| `npm run typecheck`    | `tsc --noEmit`           |
| `npm run format`       | Formata com Prettier     |
| `npm run format:check` | Verifica a formatação    |

Servidor de desenvolvimento: ver [Instalação](#instalação). Banco (`db:*`): ver [Comandos do Prisma](#comandos-do-prisma). Docker (`docker:*`): ver [Docker + Quick Tunnel](#docker--quick-tunnel-cloudflare).

## Deploy

### Render

O `render.yaml` (Blueprint: dashboard → **New + → Blueprint** → este repositório) cria o serviço web (Docker, `Dockerfile` da raiz) e um Postgres gerenciado do Render, ambos no plano grátis — o banco grátis expira em 30 dias e o serviço "dorme" após 15 min sem acesso. Health check em `/login`.

Em **Environment** no Render (o que cada variável faz está em [Configuração](#configuração-variáveis-de-ambiente)):

- **Já preenchidas pelo Blueprint:** `DATABASE_URL` (banco do Render — para usar o Neon, troque pela connection string do Neon), `AUTH_SECRET` (gerada), `AUTH_TRUST_HOST` e `NEXT_PUBLIC_APP_NAME`.
- **Preencher manualmente:** `TMDB_ACCESS_TOKEN`.
- **Já declaradas, opcionais:** `PLAYBACK_AUTHORIZED_BASE_URL` (só com fonte autorizada) e `PLAYBACK_PROVIDER_BASE_URL` (deixar vazia).
- **Adicionar manualmente se usar o YouTube** (não estão no `render.yaml`): `YOUTUBE_API_KEY` e `YOUTUBE_ALLOWED_CHANNEL_IDS`.
- **Não se aplicam:** `DATABASE_DRIVER` e `MEDIA_LIBRARY_DIR`.

A imagem Docker **não** roda migrations ao subir: aplique-as no banco usado pelo Render — ver [Comandos do Prisma](#comandos-do-prisma) (aplicar migrations já commitadas).

### Docker + Quick Tunnel (Cloudflare)

```bash
docker compose build app   # builda a imagem
npm run docker:up          # sobe "app" e "cloudflared"
npm run docker:url         # imprime a URL pública atual
```

O túnel é um "Quick Tunnel" gratuito: **a URL muda sempre que o container `cloudflared` é recriado** — pegue sempre a atual com o comando de URL acima. O app lê o `.env` e continua usando o banco do `DATABASE_URL` (Neon); o serviço `postgres` do compose só sobe se você pedir.

## Estrutura de diretórios

```
prisma/
  schema.prisma         Modelo de dados
  migrations/           Histórico de migrations
  seed.ts               Dados fictícios para desenvolvimento

src/
  app/
    (auth)/             /login e /signup
    admin/              Painel (/admin/movies, /series, /genres) — requireAdmin()
    api/auth/           NextAuth
    api/tmdb/           search, movie/[id], series/[id] — role ADMIN
    api/video-sources/  Busca/listagem de arquivos nas fontes de vídeo — role ADMIN
    api/library/        Streaming dos arquivos de "Meus arquivos" (Range) — login
    api/playback/       movie/[tmdbId], tv/[tmdbId]/[season]/[episode] — login
    watch/              /watch/[slug] (filme), /watch/series/[slug] (série), actions de progresso
    favorites/          Server Action de "Minha lista"
    movies/ series/ search/ my-list/ settings/ profiles/ about/
  components/
    ui/                 Componentes genéricos (Button, Input, Select, Textarea)
    layout/             Header, Footer, Logo, navegação, busca
    playback/           PlaybackPlayer, MoviePlayback, EpisodePlayback
  features/
    admin/              Formulários e seções do painel (TMDB, imagens, vídeo, episódios, pasta)
    auth/ favorites/ home/ profiles/ settings/
    watch/              WatchPlayer, WhereToWatch, MissingVideoNotice
  services/
    tmdb/               Cliente, serviço, tipos e mapper da TMDB
    playback/           PlaybackResolver, tipos e providers (authorized, example, internet-archive, youtube)
    video-sources/      Fontes para vincular arquivos no painel (my-files, internet-archive, wikimedia-commons)
    *.service.ts        Regras de negócio (content, movie, series, genre, favorite, playback, library, user, profile...)
  repositories/         Acesso a dados via Prisma + mappers para tipos de domínio
  lib/                  prisma, auth, password, rate-limit, cookies de perfil, require-admin/profile, media-library
  schemas/              Validação Zod
  utils/ types/ config/ constants/ hooks/
  generated/prisma/     Prisma Client gerado — não editar
```

## Decisões arquiteturais

```
Componente (Server/Client Component)
        │
        ▼
   services/*.service.ts        → regras de negócio
        │
        ▼
 repositories/*.repository.ts   → acesso a dados (Prisma → PostgreSQL)
        │
        ▼
   repositories/*.mapper.ts     → modelo do Prisma → tipo de domínio
```

- Componentes não acessam repositórios nem APIs externas diretamente.
- Dados externos (TMDB, YouTube, Internet Archive, Wikimedia Commons) passam por um serviço/mapper próprio antes de chegar ao resto do app.
- Chaves de API são lidas só no servidor; URLs de vídeo e imagem gravadas no banco são sempre reconstruídas no servidor a partir da fonte, nunca aceitas do cliente.
- Adicionar uma fonte de reprodução = um arquivo em `services/playback/providers/` + uma linha em `services/playback/index.ts`. Adicionar uma fonte para o painel = um arquivo em `services/video-sources/` + uma linha no `index.ts` de lá.
- `lib/prisma.ts` escolhe o driver adapter: `@prisma/adapter-pg` por padrão, `@prisma/adapter-neon` (WebSocket) com `DATABASE_DRIVER="neon-ws"`.

## Roteiro

Concluído:

- ~~Arquitetura, banco (PostgreSQL + Prisma) e Home com dados reais~~
- ~~Autenticação (Auth.js + Argon2id) e perfis (até 5, perfil infantil)~~
- ~~Integração com a TMDB~~
- ~~Painel administrativo (filmes, séries, temporadas/episódios, gêneros, import TMDB)~~
- ~~Imagens da TMDB (pôster/backdrop)~~
- ~~Vídeos vinculados (Meus arquivos, Internet Archive, Wikimedia Commons) + `WatchPlayer`~~
- ~~Favoritos ("Minha lista")~~
- ~~Progresso e "Continuar assistindo" (arquivos vinculados)~~
- ~~"Onde assistir" (TMDB Watch Providers / JustWatch) com atribuição~~
- ~~PlaybackResolver + PlaybackPlayer~~
- ~~Provider Internet Archive (curado)~~
- ~~Provider YouTube (allowlist de canais)~~
- ~~Deploy (Render Blueprint, Docker + Quick Tunnel)~~

Pendente:

- Tela de histórico (os dados já são gravados em `WatchHistory`).
- Progresso/histórico para fontes via iframe (depende de APIs de cada player, ex.: YouTube IFrame API).
- HLS em todos os navegadores (hls.js) e providers que usem `direct`/`hls`/`external`.
- Upload de mídia próprio (pôster, avatar, vídeo) com storage S3/R2/MinIO — o enum já existe, a implementação não.
- Editar/excluir perfis e avatar.
- Reimportar/adicionar temporadas e episódios depois que a série foi criada.
- Episódios no provider curado do Internet Archive.
- `YOUTUBE_*` no `render.yaml`.
- Rate limit compartilhado (Redis) para várias instâncias.
