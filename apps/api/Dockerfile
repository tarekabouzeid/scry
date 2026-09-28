# Multi-stage build for the API, run from the monorepo root:
#   docker build -f apps/api/Dockerfile -t scry-api .
FROM node:24-trixie-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY . .
RUN pnpm --filter @scry/shared build \
    && pnpm --filter @scry/db build \
    && pnpm --filter @scry/api build \
    && pnpm --filter @scry/api deploy --prod --legacy /out/api
# --legacy: pnpm (v10 and later) defaults to symlinked ("injected") workspace deps on
# deploy, which don't survive being copied into the runtime stage below.

FROM node:24-trixie-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/api ./
EXPOSE 3001
CMD ["node", "dist/main.js"]
