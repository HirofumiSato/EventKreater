# syntax=docker/dockerfile:1

# Next.js（App Router）+ Prisma のイメージ。
# 開発は target=dev、本番相当は target=runner を使う。
# services/flyer は別コンテキスト・別 Dockerfile でビルドする。

# Node 20 は 2026-04 に EOL。Next 14.2 / Prisma 5.22 は Node 22 で動く。
FROM node:22-bookworm-slim AS base
WORKDIR /app
# Prisma のクエリエンジンが openssl を要求する。slim には入っていない。
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1
ENV TZ=Asia/Tokyo

# 依存だけを先に入れてレイヤーキャッシュを効かせる。
# postinstall の `prisma generate` が動くよう、schema は先に置く。
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# 開発用。ソースは compose が bind mount するので、ここは
# ボリュームの初期化（Linux 版 node_modules）と単体起動のための経路。
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
EXPOSE 3012
CMD ["npm", "run", "dev:web"]

# 本番ビルド。NEXT_PUBLIC_* はビルド時に焼き込まれるので ARG で受ける。
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_APP_URL=http://localhost:3012
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
# ビルド中に route モジュールが評価され、PrismaClient が DATABASE_URL を
# 検証する。接続はしないのでダミーで足りる。本物は実行時に渡す。
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV JWT_SECRET=build-time-placeholder-secret-32-chars
RUN npx prisma generate && npm run build

# 本番実行。next.config.mjs の output: "standalone" が前提。
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3012
ENV HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs
# src/modules/flyers/lib/flyer.ts は process.cwd()/storage/flyers に書き込む。
# /app は root 所有なので、先に作って nextjs に渡す（compose のボリューム初期化も
# この所有者を引き継ぐ）。
RUN mkdir -p /app/storage/flyers && chown -R nextjs:nodejs /app/storage
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Prisma の生成物が standalone のトレースから漏れる場合の保険。
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma/client ./node_modules/@prisma/client
USER nextjs
EXPOSE 3012
CMD ["node", "server.js"]
