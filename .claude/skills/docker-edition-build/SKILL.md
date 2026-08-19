---
name: docker-edition-build
description: Build, tag, run, and troubleshoot the StatusWatch Light and UI Docker editions (Dockerfile.light / Dockerfile.ui, docker-compose profiles). Use whenever the user wants to build or run either edition's container, debug a Docker build failure, change image tags, or asks about differences between the two editions' container setup.
---

# Docker Edition Build

StatusWatch builds two separate images from one source tree: `statuswatch:light` (polling + notifications only, no server) and `statuswatch:ui` (adds the Express dashboard + SQLite). Never conflate the two — a build change for one must not silently affect the other.

## Building

```bash
# Light edition
docker build -f Dockerfile.light -t statuswatch:light .

# UI edition
docker build -f Dockerfile.ui -t statuswatch:ui .

# Both, via compose (profile-gated)
docker compose --profile light build
docker compose --profile ui build
```

## Running

```bash
docker compose --profile light up -d    # needs ./config.yml mounted, no exposed port
docker compose --profile ui up -d       # exposes :3000, no config.yml needed (config lives in SQLite)
```

Sanity checklist before declaring a build "done":

- [ ] Light image has **no** `EXPOSE` and does not start an HTTP server — `docker exec <container> sh -c "ps aux"` should show only the Node polling process, nothing listening on a port.
- [ ] Light image fails fast and clearly if `config.yml` is missing or fails zod validation — check logs on a container started without the volume mounted, to confirm the error message is actionable.
- [ ] UI image exposes `:3000` and `/health` returns 200 within a few seconds of container start.
- [ ] Both images pass their `HEALTHCHECK` (`docker ps` should show `healthy`, not `starting` forever or `unhealthy`).
- [ ] Neither image bakes in any secret — `docker history <image>` should show no `ENV` layer with a real token value; secrets only ever come from the runtime `.env` / `env_file`.

## Common build failures

- **"Cannot find module" at runtime but build succeeded**: usually means `COPY --from=builder /app/dist/<edition> ./dist` is copying the wrong sub-path, or `npm run build:light`/`build:ui` isn't actually splitting output by edition. Check the build script in `package.json` first.
- **UI edition builds but dashboard shows blank page**: check that `src/ui/public` (or the built frontend) was actually copied into the runtime stage — it's easy to forget alongside `dist/`.
- **Light edition container exits immediately**: almost always a config validation failure (missing required field, bad YAML) — check `docker logs` before assuming it's a code bug.

## Tagging for release

Use semantic, edition-qualified tags — never a bare `latest` that doesn't indicate edition:

```
statuswatch:light-v1.0.0
statuswatch:ui-v1.0.0
statuswatch:light-latest
statuswatch:ui-latest
```

When publishing to a registry, push both edition tags for every release — don't ship a Light release without also cutting the corresponding UI tag (or explicitly note in the changelog that the UI edition is unchanged).
