---
name: docker-edition-build
description: Build, tag, run, and troubleshoot the IsItDown Light and UI Docker editions (one multi-stage Dockerfile with light/ui targets, docker-compose profiles). Use whenever the user wants to build or run either edition's container, debug a Docker build failure, change image tags, or asks about differences between the two editions' container setup.
---

# Docker Edition Build

IsItDown builds two separate images from one source tree: `isitdown:light` (polling + notifications only, no server) and `isitdown:ui` (adds the Express dashboard + SQLite). Never conflate the two — a build change for one must not silently affect the other.

## Building

```bash
# Light edition
docker build --target light -t isitdown:light .

# UI edition — its stage is FROM light, so this reuses every light layer
docker build --target ui -t isitdown:ui .

# Both, via compose (profile-gated; each service selects its own target)
docker compose --profile light build
docker compose --profile ui build
```

There are **four** named stages, in this order: `builder`, `light`, `dev`, `ui`.
Not a `Dockerfile.light` and a `Dockerfile.ui` — one `Dockerfile`. Order matters:
`ui` is deliberately last so a target-less `docker build .` still builds it.

- `builder` runs `npm ci` with full devDependencies, copies `tsconfig.json`,
  `tsconfig.light.json`, `tsconfig.web.json`, `vite.config.ts`, and
  `components.json`, then `npm run build`, which runs `tsc` for the server,
  `vite build` for the dashboard (emitting the hashed bundle straight into
  `dist/ui/public` — that directory is Vite's build output now, not a tree
  copied verbatim from source), and `tools/copy-assets.mjs` for the two
  things `tsc`/Vite don't touch: `src/core/i18n` (notification catalogs,
  needed by both editions at runtime) and `src/ui/web/locales` (dashboard
  catalogs the server enumerates from disk, even though Vite also bundles
  them into the client).
- `light` and `ui` copy their compiled output from `builder` and run
  `npm ci --omit=dev`, so neither runtime stage carries Vite or any other
  devDependency.
- `dev` exists only for `docker-compose.dev.yml` / `npm run dev:docker`. It
  is never built by `docker compose --profile ui up` (that pins `target: ui`)
  and is tagged `isitdown:dev`, never `isitdown:ui`, so a dev build can't
  overwrite the production image. It needs the full `builder` tree — with
  devDependencies, i.e. Vite — because the `light`/`ui` stages' `npm ci
  --omit=dev` deliberately drops exactly what `dev` mode needs to rebuild the
  bundle on save.
- `ui` starts `FROM light`, so the UI image is the Light image plus one thin
  layer — if a change to the light stage breaks, it breaks both editions, so
  rebuild and check both.

### `WEB_DIR` in the two dev modes

`src/ui/app.ts` reads `WEB_DIR` for where to serve the dashboard from,
defaulting to `src/ui/public` next to `app.ts` — a path that no longer exists
on disk at all now that the build output lives in `dist/ui/public`.

- `npm run dev:ui` (local) sets `WEB_DIR=./dist/ui/public` explicitly on the
  Express process and *also* runs a Vite dev server with HMR on `:5173`
  (proxying API paths back to `:3000`) — the dashboard the operator should
  look at is `:5173`, not the Express-served `WEB_DIR`.
- `npm run dev:docker` sets `WEB_DIR=/app/dist/ui/public` in
  `docker-compose.dev.yml` and relies on `vite build --watch` (started in the
  `dev` stage's `CMD`) to keep that directory current on every save — there
  is no Vite dev server or HMR in this mode, only Express on `:3000` serving
  whatever the last watch-triggered build produced.

See `CLAUDE.md`'s "Build & run" section for the operator-facing version of
this split.

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
- **UI edition builds but dashboard shows blank page**: check that `dist/ui/public` (Vite's build output, produced by `vite build` inside the `builder` stage's `npm run build`) was actually copied into the runtime stage alongside the rest of `dist/`. Also check the entry asset itself, not just `index.html` — see CLAUDE.md's "prove it live" recipe; a bundle whose hashed asset 404s still serves a perfectly normal-looking `index.html`.
- **Light edition container exits immediately**: almost always a config validation failure (missing required field, bad YAML) — check `docker logs` before assuming it's a code bug.

## Tagging for release

Use semantic, edition-qualified tags — never a bare `latest` that doesn't indicate edition:

```
isitdown:light-v1.0.0
isitdown:ui-v1.0.0
isitdown:light-latest
isitdown:ui-latest
```

When publishing to a registry, push both edition tags for every release — don't ship a Light release without also cutting the corresponding UI tag (or explicitly note in the changelog that the UI edition is unchanged).
