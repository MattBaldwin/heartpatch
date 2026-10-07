# syntax=docker/dockerfile:1
# Production server image (tech spec §11, §12). Build from the repo root:
#   docker build -f infra/docker/server.Dockerfile -t heartpatch-server .
# The runtime stage has Node and production dependencies only: no pnpm,
# TypeScript or dev tooling. Commands run from apps/server, so the paths in
# the docs work as written: `node dist/db/cli.js migrate`, `node dist/ops/…`.

FROM node:22-bookworm-slim AS pnpm
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Pinned by package.json "packageManager".
RUN corepack enable
WORKDIR /repo
# Manifests only, so the install layers are cached until dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY packages/shared/package.json packages/shared/

# Production dependencies of the server and the workspace packages it uses.
FROM pnpm AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @heartpatch/server...

# Full install and build: shared first (the server resolves its dist/), then server.
FROM pnpm AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @heartpatch/server...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @heartpatch/server... build

FROM node:22-bookworm-slim AS server
ENV NODE_ENV=production
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
# The build number (commits on main) and short sha (#198), from the deploy's
# build args: the build context has no .git. Empty means unset.
ARG APP_BUILD=
ARG APP_COMMIT=
ENV APP_BUILD=$APP_BUILD APP_COMMIT=$APP_COMMIT
WORKDIR /app
COPY --from=prod-deps /repo/node_modules node_modules
COPY --from=prod-deps /repo/packages/shared/node_modules packages/shared/node_modules
COPY --from=prod-deps /repo/apps/server/node_modules apps/server/node_modules
COPY --from=build /repo/package.json ./
COPY --from=build /repo/packages/shared/package.json packages/shared/
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/server/package.json apps/server/
COPY --from=build /repo/apps/server/dist apps/server/dist
WORKDIR /app/apps/server
# Files stay root-owned and read-only to the app; it runs as the image's `node` user.
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
