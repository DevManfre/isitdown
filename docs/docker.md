[← README](../README.md)

## 4. Docker

### 4.1 Images and build targets

One `Dockerfile`, four stages. `builder` compiles everything once; `light` and
`ui` are the two shipped runtime images; `dev` exists only for
[live development](development.md#93-live-development) and is never built by
`docker compose --profile ui up`.

```
builder  node:24-alpine   npm ci (incl. devDependencies), tsc, vite build, copy non-TS assets into dist
light    node:24-alpine   prod deps + dist/{core,adapters,notifiers,light}
                          VOLUME /app/config /app/data · no EXPOSE · no server
dev      FROM builder     keeps devDependencies · vite build --watch + node --watch · tagged isitdown:dev only
ui       FROM light       + dist/ui (dashboard and locales) · EXPOSE 3000
```

`builder` now also copies `tsconfig.web.json`, `vite.config.ts` and
`components.json` alongside the server tsconfigs, and `npm run build` runs `tsc`,
then Vite, then the asset copy — one `RUN` layer that both runtime stages below
it share. `light` and `ui` are otherwise unchanged: the `ui` stage still begins
`FROM light`, so the UI image is the Light image plus a single thin layer — base
image, production dependencies and the whole core engine are shared on disk and
in a registry.

`dev`, the third stage, is `FROM builder` rather than `FROM light` — live
development needs the devDependencies (Vite, React, the test tooling) that
`light`'s production `npm ci --omit=dev` deliberately drops, so it cannot run from
either shipped image. It is tagged `isitdown:dev`, never `isitdown:ui`, and only
`docker-compose.dev.yml` builds it; a target-less `docker build .` or
`docker compose --profile ui up` never touches it.

```bash
docker build --target light -t isitdown:light .
docker build --target ui    -t isitdown:ui    .
```

Measured: 12 of the UI image's 14 layers are byte-identical to the Light image.

Tag releases per edition rather than with a bare `latest`, which would not say
which edition it is. `.github/workflows/release.yml` pushes four tags per
release to GHCR, each a multi-arch manifest covering `linux/amd64` and
`linux/arm64`:

```
ghcr.io/devmanfre/isitdown:light-v1.0.0   ghcr.io/devmanfre/isitdown:light-latest
ghcr.io/devmanfre/isitdown:ui-v1.0.0      ghcr.io/devmanfre/isitdown:ui-latest
```

Every pushed image carries an SBOM and SLSA provenance, and is signed keylessly
with `cosign`, so what built it is verifiable rather than merely asserted:

```bash
cosign verify ghcr.io/devmanfre/isitdown:ui-latest \
  --certificate-identity-regexp '^https://github.com/DevManfre/isitdown/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

See [9.6](development.md#96-releasing) for how a release is cut.

### 4.2 Compose profiles

```bash
docker compose --profile light up -d           # mounts ./config.yml (ro) + a data volume
docker compose --profile ui    up -d           # data volume only, publishes :3000
docker compose --profile light --profile ui up -d      # both
docker compose --profile light --profile ui down       # stop; volumes survive
```

Both services declare a published `image:` and `pull_policy: missing`, so a
plain `up` pulls from GHCR and the file works with no source tree around it.
Adding `--build` builds the same target from this `Dockerfile` instead.

A third file, `docker-compose.dev.yml`, layers on top of the `ui` profile and runs
the edition straight from the source tree, rebuilding the dashboard bundle in the
background as files change rather than requiring a fresh image — see
[9.3](development.md#93-live-development).

### 4.3 Volumes, healthchecks, users

| | Light | UI |
|---|---|---|
| Mounts | `./config.yml:/app/config/config.yml:ro`, volume on `/app/data` | volume on `/app/data` |
| Ports | none | `3000:3000` |
| Healthcheck | age of `state.json` — every cycle rewrites it, three intervals without a write is unhealthy | `GET /ready` |
| Start period | 40s | 60s |
| User | `node`, unprivileged | `node`, unprivileged |

The Light edition has no server to probe, which is why its liveness signal is the
freshness of the state file rather than an HTTP response.

The UI edition's probe is **readiness**, not liveness. `GET /health` answers as
long as the process is up, which is all a liveness probe may ever mean — a
restart is not the answer to someone else's outage — and it left the one failure
an operator actually wants surfaced reported by nothing: an instance whose poll
cycle had been failing all day still looked healthy. `GET /ready` is that
reading, on the same three-intervals-of-slack rule as the Light edition's state
file, and it is what the container asks. Both are still there, so an
orchestrator that wants the two probes apart can have them (`livenessProbe` on
`/health`, `readinessProbe` on `/ready`). The longer start period is the cost:
readiness stays 503 until the history backfill and the first cycle are done.

Both containers stop cleanly on `SIGTERM`: the scheduler stops, the in-flight cycle
is awaited, the store is closed, exit 0.

---

### 4.4 Kubernetes

Both editions ship as manifests and as a Helm chart, under `deploy/`:

```bash
# Plain manifests, no Helm
kubectl apply -f deploy/k8s/ui.yaml
kubectl port-forward svc/isitdown-ui 3000:3000

# Or the chart, either edition
helm install isitdown deploy/helm/isitdown --set edition=ui
helm install isitdown-light deploy/helm/isitdown --set edition=light
```

One chart rather than two, because the two editions are one codebase and differ
in exactly three ways a chart cares about: the UI edition serves HTTP and so has
a Service and HTTP probes, the Light edition reads a `config.yml` and so has a
ConfigMap, and each has its own image tag. `edition` picks which, and an
unrecognised value fails the render rather than producing half a release.

Three properties are deliberate rather than defaults:

- **One replica, and `Recreate` rather than `RollingUpdate`.** Both editions own
  a file in the data volume — the UI edition's SQLite database, the Light
  edition's state file — so a second replica is a second poller writing the same
  file, and a rolling update would stall waiting for a `ReadWriteOnce` volume the
  outgoing pod still holds.
- **`livenessProbe` on `/health`, `readinessProbe` on `/ready`** (§4.3). A
  provider being unreachable must never restart the pod, and a pod whose cycles
  have been failing must not be sent traffic. The Light edition has no HTTP
  surface at all, so its liveness probe runs the same script the image's own
  `HEALTHCHECK` does.
- **The claim outlives the release.** The PVC carries
  `helm.sh/resource-policy: keep`: the history, the incidents and the credentials
  saved from the dashboard are not something a `helm uninstall` should take with
  it.

Credentials go in a Secret and reach the container as environment variables,
exactly as they do under Docker — `secrets:` in `values.yaml` for a quick start,
`existingSecret:` for a cluster where values end up in a repository. The Light
edition's `config.yml` is `config:` in `values.yaml`, rendered into a ConfigMap
and mounted read-only; `${VAR}` references in it resolve against that same Secret.
An edit to it rolls the pod, because a mounted ConfigMap changing on disk
restarts nothing on its own.
