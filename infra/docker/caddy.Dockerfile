# syntax=docker/dockerfile:1
# Caddy with the built client baked in (tech spec §11, §12). Build from the repo root:
#   docker build -f infra/docker/caddy.Dockerfile -t heartpatch-caddy .

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @heartpatch/client...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/client apps/client
# The version line in the profile menu (#198): the build number (commits on
# main) and short sha, from the deploy's build args (the build context has no
# .git); a build stage sees its ARGs as env vars. Unset, the client says
# `v0.dev`. Declared here so the install layer above stays cached.
ARG APP_BUILD=
ARG APP_COMMIT=
RUN pnpm --filter @heartpatch/client build

FROM caddy:2-alpine AS caddy
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/client/dist /srv
# Fail the build, not the deploy, on a broken Caddyfile.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
