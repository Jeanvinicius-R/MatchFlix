# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# MatchFlix — imagem de produção (Next.js 16, output "standalone").
# Só a aplicação: o banco vem do serviço "postgres" do docker-compose.yml
# (fluxo padrão, LAN) ou de um Postgres externo (Neon/Render) via DATABASE_URL.
# ---------------------------------------------------------------------------

# ---- deps: só instala dependências (cache separado do código-fonte) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Prisma (rodado pelo postinstall) precisa do OpenSSL pra detectar a versão
# certa do engine — sem isso ele avisa e assume 1.1.x, que não bate com o
# OpenSSL 3.x do bookworm.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma7.config.ts ./
RUN npm ci

# ---- builder: compila a aplicação ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# DATABASE_URL só precisa EXISTIR para o build não falhar (src/lib/prisma.ts
# lança erro se a env var estiver ausente) — o Prisma client usa a URL real,
# injetada em runtime pelo docker-compose, não esta aqui.
ARG DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV DATABASE_URL=$DATABASE_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---- runner: imagem final, mínima, sem node_modules completo ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# Sem pasta public/ neste projeto (o ícone é servido pela rota /icon.svg) —
# se um dia existir, "COPY public ./public" volta a ser necessário aqui.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Storage LOCAL dos uploads (MEDIA_UPLOAD_DIR padrão = /app/uploads). Monte um
# volume aqui para os arquivos sobreviverem à recriação do container.
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
