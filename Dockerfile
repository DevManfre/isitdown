# IsItDown ships two editions from one source tree and one Dockerfile.
#
#   docker build --target light -t isitdown:light .
#   docker build --target ui    -t isitdown:ui    .
#
# A third target, `dev`, exists only for docker-compose.dev.yml — it is never
# built by `docker compose --profile ui up` (that pins `target: ui`) and it is
# tagged `isitdown:dev`, never `isitdown:ui`, so a dev build cannot overwrite
# the production image. `ui` is deliberately the last stage in this file, so a
# target-less `docker build .` still builds `ui`.
#
# The `ui` stage starts FROM `light`, so the UI image is the Light image plus a
# single thin layer: everything below it — base image, production dependencies,
# core engine — is shared on disk and in a registry.

# --- Build stage ---------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.light.json tsconfig.web.json vite.config.ts components.json ./
COPY tools ./tools
COPY src ./src
# Builds every edition once, so this layer is shared by both runtime stages.
RUN npm run build

# --- Light edition -------------------------------------------------------------
FROM node:24-alpine AS light
WORKDIR /app
ENV NODE_ENV=production
ENV CONFIG_PATH=/app/config/config.yml
ENV DATA_PATH=/app/data/state.json
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist/core ./dist/core
COPY --from=builder /app/dist/adapters ./dist/adapters
COPY --from=builder /app/dist/notifiers ./dist/notifiers
COPY --from=builder /app/dist/light ./dist/light
RUN mkdir -p /app/config /app/data && chown -R node:node /app
USER node
VOLUME ["/app/config", "/app/data"]
# No EXPOSE and no server: this edition only polls and notifies.
# The state file is rewritten by every cycle, so its age is the liveness signal.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "dist/light/healthcheck.js"]
CMD ["node", "dist/light/index.js"]

# --- UI edition, dev mode: the builder stage, live -----------------------------
# FROM builder, not light/ui: dev mode needs the full devDependencies tree
# (vite) and node_modules that npm ci --omit=dev deliberately drops from the
# runtime stages. docker-compose.dev.yml mounts ./src read-only over this and
# Vite rewrites the React bundle into this stage's own /app/dist on save —
# writable because the stage stays root, and deliberately not a volume, so the
# tree never outlives the image it was built from.
#
# NODE_ENV and the healthcheck are this stage's own, not inherited from
# light/ui: the image says development rather than leaving it to the compose
# override, and liveness is judged on the source tree the stage actually runs
# (types stripped at load) rather than on a compiled artifact it never loads.
FROM builder AS dev
ENV NODE_ENV=development
ENV DB_PATH=/app/data/isitdown.db
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "src/ui/healthcheck.ts"]
CMD ["sh", "-c", "npx vite build --watch & exec node --watch src/ui/server.ts"]

# --- UI edition: the light image plus the server layer ----------------------------
# Starting FROM light means every layer below this point — base image, production
# dependencies, core engine — is shared with isitdown:light on disk and in a
# registry. The UI image is that image plus one thin layer. Kept as the last
# stage in the file so a target-less `docker build .` still builds this one.
FROM light AS ui
ENV DB_PATH=/app/data/isitdown.db
ENV PORT=3000
USER root
COPY --from=builder /app/dist/ui ./dist/ui
RUN chown -R node:node /app/dist/ui
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "dist/ui/healthcheck.js"]
CMD ["node", "dist/ui/server.js"]
