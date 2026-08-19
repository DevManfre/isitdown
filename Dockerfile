# StatusWatch ships two editions from one source tree and one Dockerfile.
#
#   docker build --target light -t statuswatch:light .
#   docker build --target ui    -t statuswatch:ui    .
#
# The `ui` stage starts FROM `light`, so the UI image is the Light image plus a
# single thin layer: everything below it — base image, production dependencies,
# core engine — is shared on disk and in a registry.

# --- Build stage ---------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.light.json ./
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

# --- UI edition: the light image plus the server layer ----------------------------
# Starting FROM light means every layer below this point — base image, production
# dependencies, core engine — is shared with statuswatch:light on disk and in a
# registry. The UI image is that image plus one thin layer.
FROM light AS ui
ENV DB_PATH=/app/data/statuswatch.db
ENV PORT=3000
USER root
COPY --from=builder /app/dist/ui ./dist/ui
RUN chown -R node:node /app/dist/ui
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "dist/ui/healthcheck.js"]
CMD ["node", "dist/ui/server.js"]
