# MatchFlix

Plataforma de streaming de filmes e séries em Next.js: catálogo com metadados da TMDB, perfis por conta, painel administrativo, histórico e progresso de reprodução, "Onde assistir" (TMDB/JustWatch) e reprodução apenas de fontes próprias, autorizadas ou em domínio público.

> **Estado atual:** todas as funcionalidades descritas abaixo existem no código e foram validadas (testes automatizados, build de produção, imagem Docker e verificações ponta a ponta contra um PostgreSQL). Pendências reais estão em [Limitações](#limitações-conhecidas) e [Roteiro](#roteiro).

## Sumário

- [Tecnologias](#tecnologias)
- [Instalação e execução local](#instalação-e-execução-local)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Banco de dados](#banco-de-dados)
- [Comandos](#comandos)
- [Autenticação e perfis](#autenticação-e-perfis)
- [Catálogo, TMDB e "Onde assistir"](#catálogo-tmdb-e-onde-assistir)
- [Painel administrativo](#painel-administrativo)
- [Reprodução (playback)](#reprodução-playback)
- [Histórico, progresso e Minha lista](#histórico-progresso-e-minha-lista)
- [Uploads e armazenamento](#uploads-e-armazenamento)
- [Segurança](#segurança)
- [Deploy](#deploy)
- [Solução de problemas](#solução-de-problemas)
- [Estrutura de diretórios](#estrutura-de-diretórios)
- [Limitações conhecidas](#limitações-conhecidas)
- [Roteiro](#roteiro)

## Tecnologias

| Camada       | Tecnologia                                                                         |
| ------------ | ---------------------------------------------------------------------------------- |
| Framework    | Next.js 16 (App Router, Turbopack, `output: "standalone"`)                         |
| Linguagem    | TypeScript (strict)                                                                |
| Estilo       | Tailwind CSS v4; fontes Inter e Fraunces hospedadas no projeto (`next/font/local`) |
| Banco        | PostgreSQL (Neon em uso; Postgres local via Docker opcional)                       |
| ORM          | Prisma 7 com driver adapters (`@prisma/adapter-pg` ou `@prisma/adapter-neon`)      |
| Autenticação | Auth.js / NextAuth v5 (credenciais, sessão JWT) + Argon2id                         |
| Validação    | Zod (cliente e servidor) + React Hook Form                                         |
| Metadados    | API da TMDB                                                                        |
| Testes       | `node:test` executado via `tsx` (sem framework extra)                              |
| Qualidade    | ESLint + Prettier                                                                  |

## Instalação e execução local

Requisitos: Node.js 22+ (o modo `neon-ws` usa o WebSocket nativo do Node) e um PostgreSQL.

```bash
npm install            # instala dependências e roda `prisma generate` (postinstall)
cp .env.example .env   # cria o .env local a partir do modelo
npm run dev            # http://localhost:3000
```

Antes de subir o servidor, preencha o `.env` ([variáveis](#variáveis-de-ambiente)) e, se o banco for novo/vazio, aplique as migrations ([Banco de dados](#banco-de-dados)). O `.env.example` é o modelo versionado, sem valores reais; o `.env` é a cópia local com as chaves de verdade e **nunca** é commitado.

Para ter acesso ao painel, promova um usuário já cadastrado:

```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = 'seu-email@exemplo.com';
```

## Variáveis de ambiente

Só `NEXT_PUBLIC_APP_NAME` chega ao navegador; todas as outras são lidas apenas no servidor.

| Variável                       | Obrigatória | Para quê                                                                                                                                                              |
| ------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | Sim         | Connection string Postgres (`postgresql://…`). No Neon, use a "Connection string" do painel, **não** a URL da REST/Data API.                                          |
| `DATABASE_DRIVER`              | Não         | `"neon-ws"` conecta ao Neon por WebSocket (porta 443), para redes que bloqueiam a porta 5432. Vazio = conexão Postgres normal.                                        |
| `AUTH_SECRET`                  | Sim         | Segredo do Auth.js (`openssl rand -base64 32`). Trocar o valor encerra todas as sessões.                                                                              |
| `AUTH_TRUST_HOST`              | Produção    | `true` ao rodar o build de produção, atrás de proxy ou acessando por IP/domínio — sem ele o login falha com `UntrustedHost`.                                          |
| `NEXT_PUBLIC_APP_NAME`         | Não         | Nome público do site.                                                                                                                                                 |
| `TMDB_ACCESS_TOKEN`            | Recomendado | "API Read Access Token" da TMDB (Configurações → API em themoviedb.org). Sem ele: sem busca/importação no painel, sem "Onde assistir" e sem metadados para o YouTube. |
| `MEDIA_LIBRARY_DIR`            | Não         | Pasta com seus próprios vídeos ("Meus arquivos"). Vazio = `./movies`.                                                                                                 |
| `MEDIA_UPLOAD_DIR`             | Não         | Pasta dos uploads (storage LOCAL). Vazio = `./uploads` (fora do Git).                                                                                                 |
| `MEDIA_UPLOAD_MAX_VIDEO_MB`    | Não         | Limite de cada vídeo enviado, em MB. Vazio = 2048.                                                                                                                    |
| `PLAYBACK_AUTHORIZED_BASE_URL` | Não         | Base http(s) de uma fonte de vídeo que você tem autorização para usar. Vazio = provider desativado.                                                                   |
| `YOUTUBE_API_KEY`              | Não         | Chave da YouTube Data API v3 (Google Cloud).                                                                                                                          |
| `YOUTUBE_ALLOWED_CHANNEL_IDS`  | Não         | Allowlist de IDs de canal (`UC…`), separados por vírgula. Vazia = provider do YouTube desativado.                                                                     |

`PLAYBACK_PROVIDER_BASE_URL` não existe mais: o provider genérico de exemplo que a usava foi removido (para uma fonte real, use `PLAYBACK_AUTHORIZED_BASE_URL`).

## Banco de dados

O schema está em [`prisma/schema.prisma`](prisma/schema.prisma):

- **User → Profile** (1:N, até 5 perfis). Histórico, progresso e Minha lista pertencem ao **perfil**.
- **Movie** e **Series → Season → Episode**, com `tmdbId` opcional e único em filmes e séries.
- **Genre ↔ Movie/Series** (N:M).
- **Media**: metadados de qualquer arquivo (pôster, banner, avatar, vídeo) — `storageProvider`, `storageKey`, `url`, tipo, tamanho. O binário fica fora do banco. `storageProvider` em uso: `LOCAL` (uploads), `INTERNET_ARCHIVE`, `WIKIMEDIA_COMMONS`, `TMDB` (imagens na CDN da TMDB). `S3`, `R2` e `MINIO` existem no enum, mas não têm implementação.
- **WatchHistory** (log de inícios de reprodução), **WatchProgress** (uma linha por perfil+conteúdo) e **Favorite** referenciam filme **ou** episódio/série.

```bash
npm run db:migrate   # cria/aplica migrations em desenvolvimento
npm run db:deploy    # aplica migrations já commitadas (produção/Neon)
npm run db:generate  # regenera o Prisma Client
npm run db:studio    # explorador visual do banco
npm run db:seed      # catálogo FICTÍCIO de desenvolvimento (sem tmdbId)
```

O Prisma CLI conecta pela porta 5432; `DATABASE_DRIVER="neon-ws"` resolve a **aplicação**, não o CLI — em redes que bloqueiam a 5432, rode migrations de outra rede. Postgres local opcional: `docker compose up -d postgres` (o `DATABASE_URL` do `.env.example` já aponta para ele).

## Comandos

| Comando                | Descrição                                                            |
| ---------------------- | -------------------------------------------------------------------- |
| `npm run build`        | Build de produção                                                    |
| `npm run start`        | Sobe o build de produção                                             |
| `npm test`             | Testes automatizados (`node:test` via `tsx`)                         |
| `npm run typecheck`    | `next typegen` (tipos de rotas, ex.: `LayoutProps`) + `tsc --noEmit` |
| `npm run lint`         | ESLint                                                               |
| `npm run format`       | Formata com Prettier                                                 |
| `npm run format:check` | Verifica a formatação                                                |

Servidor de desenvolvimento: ver [Instalação](#instalação-e-execução-local). Banco (`db:*`): ver [Banco de dados](#banco-de-dados). Docker (`docker:*`): ver [Docker + Quick Tunnel](#docker--quick-tunnel-cloudflare).

## Autenticação e perfis

- Cadastro (`/signup`), login (`/login`) e logout com Auth.js v5 (e-mail + senha) e sessão JWT em cookie `httpOnly`. Senhas com Argon2id; erros de login genéricos e tempo de resposta equalizado; limite de 5 tentativas/15 min por e-mail (em memória).
- `/settings`: alterar nome, e-mail, senha e tema claro/escuro.
- **Perfis** (`/profiles`): até 5 por conta; perfil ativo em cookie próprio (`active_profile_id`), com a posse reconferida no servidor a cada leitura.
- **Gerenciar perfis** (`/profiles/manage`, `/profiles/[id]/edit`): renomear, marcar/desmarcar perfil infantil, enviar/remover foto e excluir. Excluir apaga histórico, progresso, Minha lista e a foto do perfil; o último perfil da conta não pode ser excluído; excluir o perfil ativo limpa o cookie.
- **Perfil infantil**: só vê conteúdo com classificação `L` — filtro aplicado no servidor (catálogo, busca, Minha lista, histórico e páginas de reprodução).

## Catálogo, TMDB e "Onde assistir"

A TMDB é a fonte de metadados (título, sinopse, imagens, gêneros, classificação indicativa brasileira, temporadas e episódios). **A TMDB não fornece vídeo.** O acesso passa por `src/services/tmdb/` (cliente com cache de 24 h, serviço e mapper); o token nunca sai do servidor. A busca pública (`/search`) consulta o **banco**, não a TMDB.

**"Onde assistir"** (`WhereToWatch`, nas páginas de reprodução de títulos com `tmdbId`) mostra as opções legais no **Brasil** — assinatura, grátis, com anúncios, aluguel e compra — a partir dos TMDB Watch Providers (dados da JustWatch). É só informação: linka para a página agregadora da TMDB e **nunca** é usado como fonte de reprodução. Sem dados para o Brasil, a seção não aparece.

**Atribuição:** `/about` exibe o logo da TMDB e o aviso exigido pelos termos da API; "Onde assistir" credita a JustWatch.

## Painel administrativo

`/admin`, protegido por `requireAdmin()` no layout **e** em cada Server Action/rota.

- **Filmes e séries**: criar manualmente ou a partir da busca na TMDB (pré-preenche o formulário, grava o `tmdbId` e aplica pôster/banner); editar dados, slug e `tmdbId`; desativar (`isActive`).
- **Temporadas e episódios** (em séries existentes):
  - _Importar/atualizar da TMDB_: escolhe temporadas, cria o que falta e, opcionalmente, atualiza título/sinopse/duração do que já existe. Nunca apaga nada e não mexe em vídeos vinculados.
  - Adicionar temporada e episódio manualmente (duplicados são recusados) e editar cada episódio.
- **Imagens**: enviar pôster/banner próprios ou aplicar os da TMDB.
- **Vídeo**: enviar arquivo próprio (filme ou episódio) ou vincular de **Meus arquivos**, **Internet Archive** ou **Wikimedia Commons**; vínculo automático da pasta `MEDIA_LIBRARY_DIR` (exige ano e título no nome do arquivo, ex.: `Título (Ano).mp4`).
- **Gêneros**: criar e excluir; nomes equivalentes são unificados por slug.

## Reprodução (playback)

Ao abrir `/watch/[slug]` ou `/watch/series/[slug]?e=<episódio>`, a página escolhe uma via:

1. **Vídeo vinculado** (upload, Meus arquivos, Internet Archive, Wikimedia Commons) → `WatchPlayer` (`<video>` nativo): retoma de onde parou, salva progresso e histórico e, em séries, avança para o próximo episódio.
2. **Sem vídeo vinculado, mas com `tmdbId`** → `PlaybackSources` consulta `GET /api/playback/movie/[tmdbId]` ou `/api/playback/tv/[tmdbId]/[s]/[e]` (exigem login). O **PlaybackResolver** roda os providers em paralelo (5 s cada; um provider que falha nunca esconde os outros) e o `PlaybackPlayer` toca a fonte escolhida, com troca de fonte e tela cheia.
3. **Nenhum dos dois** → aviso "ainda não disponível" (admin vê o atalho para vincular vídeo).

| Provider           | Ativo quando                                            | Filmes | Episódios | Progresso/histórico                |
| ------------------ | ------------------------------------------------------- | ------ | --------- | ---------------------------------- |
| `authorized`       | `PLAYBACK_AUTHORIZED_BASE_URL` definida (só http/https) | ✔      | ✔         | Não (iframe sem API)               |
| `internet-archive` | Sempre — só para títulos da lista curada                | ✔      | —         | Não (o embed não tem API pública)  |
| `youtube`          | `YOUTUBE_API_KEY` **e** `YOUTUBE_ALLOWED_CHANNEL_IDS`   | ✔      | ✔         | Sim, via YouTube IFrame Player API |

O `authorized` só monta URLs (`${BASE}/movie/<tmdbId>`, `${BASE}/tv/<tmdbId>/<temporada>/<episódio>`); não busca nada. O `PlaybackPlayer` também suporta os tipos `direct`, `hls` (nativo, Safari/iOS) e `external`, mas nenhum provider atual os usa — por isso o hls.js não está instalado.

### Internet Archive (curadoria)

O provider **nunca pesquisa** o Archive: só toca títulos de uma lista curada à mão (`CURATED_MOVIES` em `internet-archive.provider.ts`), cada um com a licença registrada. Regra de inclusão para um catálogo brasileiro: o item declara domínio público **e** o filme foi publicado antes de 1956, ou seja, também está em domínio público no Brasil (Lei 9.610/98, art. 44). Hoje:

| Filme           | Ano  | TMDB  | Item do Archive             |
| --------------- | ---- | ----- | --------------------------- |
| His Girl Friday | 1940 | 3085  | `his_girl_friday`           |
| The General     | 1926 | 961   | `The_General_Buster_Keaton` |
| Detour          | 1945 | 20367 | `Detour`                    |

O provider só aparece para títulos cadastrados no catálogo com esse `tmdbId`. Não há episódios curados.

### YouTube

Usa **somente** a YouTube Data API v3 oficial (`search.list` + `videos.list`) e o player de embed oficial — sem scraping e sem URLs de stream. Um vídeo só vira fonte se: o canal estiver na allowlist; for `embeddable`, público, processado e não ao vivo; estiver disponível no Brasil; o título mencionar o filme/série (e, em episódios, o episódio ou um marcador como `S01E02`); e durar ao menos 75% da duração da TMDB (descarta trailers). Durante a reprodução, a **IFrame Player API** oficial fornece tempo e estado para salvar progresso e histórico.

**Estado atual: desativado.** `YOUTUBE_ALLOWED_CHANNEL_IDS` está vazia de propósito. `embeddable` não comprova licença, e a allowlist é uma decisão administrativa de quem opera o site. O único canal oficial com filmes completos identificado na pesquisa (Paramount Vault) é restrito aos EUA e seria recusado pelo filtro de região; nenhum canal foi verificado para o Brasil, e nenhum ID de canal foi adicionado.

Outras limitações: cota diária da API (cada busca gasta um `search.list` caro; respostas em cache por 24 h); casamento por nome/duração é heurístico; depende de `TMDB_ACCESS_TOKEN` para saber o que buscar.

## Histórico, progresso e Minha lista

| Recurso              | Estado                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Minha lista          | ✔ Botão nas páginas de reprodução; `/my-list`. Por perfil.                                                             |
| Progresso            | ✔ Vídeo vinculado (`WatchPlayer`) e YouTube (IFrame API). Assistido a partir de 95%; séries retomam no episódio certo. |
| Continuar assistindo | ✔ Fileira na Home com títulos não terminados (uma entrada por série).                                                  |
| Histórico (gravação) | ✔ Início de cada reprodução em `WatchHistory` — mesmas fontes do progresso.                                            |
| Histórico (tela)     | ✔ `/history`: mais recentes primeiro, uma entrada por filme/episódio, percentual assistido e atalho para continuar.    |
| Iframes sem API      | ✘ Fonte autorizada e Internet Archive não salvam progresso nem histórico (não há API oficial de tempo do player).      |

## Uploads e armazenamento

Storage **LOCAL** em disco (`MEDIA_UPLOAD_DIR`, padrão `./uploads`, fora do Git):

- Rotas: `POST /api/admin/uploads/{movie|series|episode}/{id}/{poster|backdrop|video}` (só ADMIN) e `POST/DELETE /api/profiles/{id}/avatar` (só o dono do perfil). O corpo é o arquivo bruto.
- Tipos aceitos: JPEG, PNG e WebP para imagens; MP4 e WebM para vídeo. O conteúdo é conferido pela assinatura do arquivo (magic bytes), não só pelo `Content-Type`.
- Limites: imagens 5 MB, foto de perfil 2 MB, vídeo `MEDIA_UPLOAD_MAX_VIDEO_MB` (2048 MB). O limite é aplicado durante o streaming; um upload recusado não deixa arquivo parcial.
- Nomes gerados no servidor (UUID); a chave é validada por regex antes de tocar o disco, o que bloqueia path traversal.
- Entrega: `GET /api/media/...` — imagens públicas (cache longo); vídeos e fotos de perfil exigem login; HTTP Range para avançar/voltar no vídeo.
- Ao trocar/remover uma mídia LOCAL (ou excluir um perfil), o arquivo antigo é apagado depois que a transação do banco confirma.

## Segurança

- Sessão JWT `httpOnly`; senhas Argon2id; limite de tentativas de login; validação Zod no servidor em todas as actions e rotas.
- `requireAdmin()` em cada Server Action/rota do painel; posse do perfil reconferida em toda ação de perfil, favorito, progresso e upload de foto.
- URLs de vídeo e imagem gravadas no banco são sempre reconstruídas no servidor a partir da fonte (Wikimedia restrita a `https://upload.wikimedia.org`; YouTube a `https://www.youtube.com/embed/<id>`); `?next=` só aceita caminhos do próprio site.
- Cabeçalhos em todas as respostas: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` + `frame-ancestors 'none'`, `Permissions-Policy` e sem `X-Powered-By`. Não há CSP completa porque o player incorpora iframes de terceiros e o script oficial do YouTube.
- Segredos só em `.env` (ignorado pelo Git e pelo `.dockerignore`).

## Deploy

### Render

O `render.yaml` (Blueprint: dashboard → **New + → Blueprint**) cria o serviço web (Docker) e um Postgres do Render, ambos no plano grátis (o banco grátis expira em 30 dias; o serviço "dorme" após 15 min). Health check em `/login`.

Variáveis em **Environment** (o que cada uma faz está em [Variáveis de ambiente](#variáveis-de-ambiente)):

- **Preenchidas pelo Blueprint:** `DATABASE_URL` (banco do Render — para usar o Neon, troque pela connection string do Neon), `AUTH_SECRET` (gerada), `AUTH_TRUST_HOST`, `NEXT_PUBLIC_APP_NAME`.
- **Declaradas sem valor (`sync: false`), preencher no painel:** `TMDB_ACCESS_TOKEN`; opcionais `PLAYBACK_AUTHORIZED_BASE_URL`, `YOUTUBE_API_KEY` e `YOUTUBE_ALLOWED_CHANNEL_IDS`.
- **Não se aplicam:** `DATABASE_DRIVER` e `MEDIA_LIBRARY_DIR`.

A imagem **não** roda migrations ao subir: aplique-as no banco do Render com `npm run db:deploy`. No plano grátis o disco é efêmero — **uploads somem a cada deploy/reinício**.

### Docker + Quick Tunnel (Cloudflare)

```bash
docker compose build app   # builda a imagem (Dockerfile da raiz)
npm run docker:up          # sobe "app" e "cloudflared"
npm run docker:url         # imprime a URL pública atual
```

A imagem (Node 22, `output: "standalone"`) roda como usuário sem privilégios, não contém `.env` e cria `/app/uploads` vazia; o `docker-compose.yml` monta o volume `matchflix_uploads` ali para os uploads persistirem. O app lê o `.env` do host. O Quick Tunnel é gratuito, mas a URL muda sempre que o container `cloudflared` é recriado.

## Solução de problemas

- **`Can't reach database server` / timeout com Neon:** a rede bloqueia a porta 5432 — use `DATABASE_DRIVER="neon-ws"` (Node 22+).
- **Login falha com `UntrustedHost`:** defina `AUTH_TRUST_HOST=true`.
- **`no matching decryption secret` no log:** o navegador tem uma sessão assinada com outro `AUTH_SECRET`; saia e entre de novo.
- **`npm run typecheck` acusa `LayoutProps`:** rode pelo script (ele executa `next typegen` antes do `tsc`).
- **`npm ci` falha no Docker por lockfile fora de sincronia:** o `package-lock.json` precisa ser aceito pelo npm 10 da imagem `node:22`; regenere com `npm install --package-lock-only` usando esse npm.
- **Nenhuma fonte de reprodução para um título:** é o esperado sem vídeo vinculado e sem provider configurado; veja "Onde assistir" para as opções legais.

## Estrutura de diretórios

```
prisma/                   schema, migrations e seed fictício
src/
  app/                    rotas do App Router (páginas, Server Actions, /api/*)
    fonts/                Inter e Fraunces (woff2) + licenças OFL
  components/             ui/, layout/, playback/ (PlaybackSources, PlaybackPlayer, YouTubePlayer)
  features/               admin/, auth/, favorites/, home/, profiles/, settings/, watch/
  services/               regras de negócio; tmdb/, playback/ (resolver + providers), video-sources/
  repositories/           acesso a dados via Prisma + mappers
  lib/                    auth, prisma, storage/local-storage, http-range, cookies, guards
  schemas/ types/ utils/ config/ constants/
```

Fluxo: componentes → `services/` → `repositories/` → Prisma. Dados externos passam por um serviço/mapper próprio; nenhum componente chama APIs externas ou o banco diretamente.

## Limitações conhecidas

- **YouTube desativado** até existir um canal com direitos verificáveis para o Brasil (allowlist vazia).
- **Internet Archive** só tem 3 filmes curados e nenhum episódio.
- **Progresso/histórico** não é salvo para iframes sem API oficial (fonte autorizada, Internet Archive).
- **Storage** só LOCAL; no Render grátis os uploads não persistem.
- **HLS** só nativo (Safari/iOS); nenhum provider atual entrega HLS.
- **Rate limit de login em memória**: reinicia com o processo e não é compartilhado entre instâncias (adequado a uma instância, como no Render grátis).
- **Migrations** não rodam automaticamente no deploy.
- **Papel ADMIN no JWT**: promover/rebaixar um usuário só vale após novo login.

## Roteiro

- Storage S3/R2/MinIO (o enum já existe; falta implementação e um ambiente para testar), para uploads persistentes em produção.
- hls.js, apenas se surgir uma fonte autorizada que entregue HLS.
- Fonte legal no YouTube para o catálogo brasileiro (canal com direitos verificados para a região BR).
- Mais títulos curados no Internet Archive seguindo a regra de domínio público no Brasil.
- Rate limit compartilhado (ex.: Redis) caso o app passe a rodar em várias instâncias.
