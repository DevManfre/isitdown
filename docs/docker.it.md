[← README](../README.it.md)

## 4. Docker

### 4.1 Immagini e target di build

Un solo `Dockerfile`, quattro stage. `builder` compila tutto una volta sola;
`light` e `ui` sono le due immagini di runtime distribuite; `dev` esiste solo per
lo [sviluppo live](development.it.md#93-sviluppo-live) e non viene mai costruito da
`docker compose --profile ui up`.

```
builder  node:24-alpine   npm ci (con le devDependencies), tsc, vite build, copia in dist gli asset non-TS
light    node:24-alpine   dipendenze prod + dist/{core,adapters,notifiers,light}
                          VOLUME /app/config /app/data · nessun EXPOSE · nessun server
dev      FROM builder     mantiene le devDependencies · vite build --watch + node --watch · taggato solo isitdown:dev
ui       FROM light       + dist/ui (dashboard e cataloghi) · EXPOSE 3000
```

`builder` adesso copia anche `tsconfig.web.json`, `vite.config.ts` e
`components.json` insieme ai tsconfig del server, e `npm run build` esegue `tsc`,
poi Vite, poi la copia degli asset — un unico layer `RUN` condiviso da entrambi gli
stage di runtime sotto di esso. `light` e `ui` sono per il resto invariati: lo
stage `ui` continua a partire `FROM light`, quindi l'immagine UI è l'immagine
Light più un unico layer sottile — immagine base, dipendenze di produzione e tutto
il motore sono condivisi su disco e in un registry.

`dev`, il terzo stage, è `FROM builder` invece che `FROM light`: lo sviluppo live
ha bisogno delle devDependencies (Vite, React, gli strumenti di test) che
`npm ci --omit=dev` di `light` scarta deliberatamente, quindi non può girare da
nessuna delle due immagini distribuite. È taggato `isitdown:dev`, mai
`isitdown:ui`, e solo `docker-compose.dev.yml` lo costruisce; un `docker build .`
senza target o `docker compose --profile ui up` non lo toccano mai.

```bash
docker build --target light -t isitdown:light .
docker build --target ui    -t isitdown:ui    .
```

Misurato: 12 dei 14 layer dell'immagine UI sono identici byte per byte a quelli
dell'immagine Light.

Tagga le release per edizione invece di usare un `latest` nudo, che non direbbe di
quale edizione si tratta. `.github/workflows/release.yml` pubblica quattro tag
per release su GHCR, ognuno un manifest multi-arch che copre `linux/amd64` e
`linux/arm64`:

```
ghcr.io/devmanfre/isitdown:light-v1.0.0   ghcr.io/devmanfre/isitdown:light-latest
ghcr.io/devmanfre/isitdown:ui-v1.0.0      ghcr.io/devmanfre/isitdown:ui-latest
```

Ogni immagine pubblicata porta un SBOM e la provenance SLSA, ed è firmata in
modalità keyless con `cosign`, così chi l'ha costruita è verificabile e non solo
dichiarato:

```bash
cosign verify ghcr.io/devmanfre/isitdown:ui-latest \
  --certificate-identity-regexp '^https://github.com/DevManfre/isitdown/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Vedi [9.6](development.it.md#96-rilasci) per come si taglia una release.

### 4.2 Profili compose

```bash
docker compose --profile light up -d           # monta ./config.yml (ro) + un volume dati
docker compose --profile ui    up -d           # solo volume dati, pubblica la :3000
docker compose --profile light --profile ui up -d      # entrambe
docker compose --profile light --profile ui down       # ferma; i volumi sopravvivono
```

Entrambi i servizi dichiarano un `image:` pubblicato e `pull_policy: missing`,
così un `up` semplice fa il pull da GHCR e il file funziona senza nessun
sorgente attorno. Aggiungere `--build` costruisce lo stesso target da questo
`Dockerfile`.

Un terzo file, `docker-compose.dev.yml`, si sovrappone al profilo `ui` ed esegue
l'edizione direttamente dal sorgente, ricostruendo in background il bundle della
dashboard a ogni modifica invece di richiedere un'immagine nuova — vedi
[9.3](development.it.md#93-sviluppo-live).

### 4.3 Volumi, healthcheck, utenti

| | Light | UI |
|---|---|---|
| Mount | `./config.yml:/app/config/config.yml:ro`, volume su `/app/data` | volume su `/app/data` |
| Porte | nessuna | `3000:3000` |
| Healthcheck | età di `state.json` — ogni ciclo lo riscrive, tre intervalli senza scritture è unhealthy | `GET /ready` |
| Start period | 40s | 60s |
| Utente | `node`, non privilegiato | `node`, non privilegiato |

L'edizione Light non ha un server da interrogare: per questo il suo segnale di
liveness è la freschezza del file di stato e non una risposta HTTP.

La sonda dell'edizione UI è la **readiness**, non la liveness. `GET /health`
risponde finché il processo è in piedi, che è tutto ciò che una sonda di liveness
può significare — un restart non è la risposta all'outage di qualcun altro — e
lasciava senza alcun segnale l'unico guasto che un operatore vuole davvero
vedere: un'istanza il cui ciclo di polling falliva da un giorno intero risultava
comunque healthy. `GET /ready` è quella lettura, con la stessa tolleranza di tre
intervalli del file di stato dell'edizione Light, ed è ciò che interroga il
container. Restano entrambe, così un orchestratore che vuole le due sonde
separate può averle (`livenessProbe` su `/health`, `readinessProbe` su
`/ready`). Lo start period più lungo è il prezzo: la readiness resta 503 finché
il backfill della storia e il primo ciclo non sono finiti.

Entrambi i container si fermano in modo pulito su `SIGTERM`: lo scheduler si arresta,
il ciclo in corso viene atteso, lo store viene chiuso, exit 0.

---

### 4.4 Kubernetes

Entrambe le edizioni arrivano come manifest e come chart Helm, sotto `deploy/`:

```bash
# Manifest semplici, senza Helm
kubectl apply -f deploy/k8s/ui.yaml
kubectl port-forward svc/isitdown-ui 3000:3000

# Oppure il chart, per una delle due edizioni
helm install isitdown deploy/helm/isitdown --set edition=ui
helm install isitdown-light deploy/helm/isitdown --set edition=light
```

Un chart solo e non due, perché le due edizioni sono un unico codebase e
differiscono esattamente in tre punti che a un chart interessano: l'edizione UI
serve HTTP e quindi ha un Service e delle probe HTTP, l'edizione Light legge un
`config.yml` e quindi ha una ConfigMap, e ognuna ha il suo tag immagine.
`edition` sceglie quale, e un valore che non esiste fa fallire il render invece
di produrre mezza release.

Tre proprietà sono volute e non default:

- **Una sola replica, e `Recreate` invece di `RollingUpdate`.** Entrambe le
  edizioni possiedono un file nel volume dati — il database SQLite dell'edizione
  UI, il file di stato di quella Light — quindi una seconda replica è un secondo
  poller che scrive lo stesso file, e un rolling update resterebbe fermo ad
  aspettare un volume `ReadWriteOnce` che il pod uscente tiene ancora.
- **`livenessProbe` su `/health`, `readinessProbe` su `/ready`** (§4.3). Un
  provider irraggiungibile non deve mai far riavviare il pod, e un pod i cui
  cicli stanno fallendo non deve ricevere traffico. L'edizione Light non espone
  HTTP affatto, quindi la sua liveness probe esegue lo stesso script
  dell'`HEALTHCHECK` dell'immagine.
- **Il claim sopravvive alla release.** Il PVC porta
  `helm.sh/resource-policy: keep`: la cronologia, gli incidenti e le credenziali
  salvate dalla dashboard non sono roba che un `helm uninstall` debba portarsi
  via.

Le credenziali stanno in un Secret e arrivano al container come variabili
d'ambiente, esattamente come sotto Docker — `secrets:` in `values.yaml` per
partire in fretta, `existingSecret:` per un cluster dove i values finiscono in un
repository. Il `config.yml` dell'edizione Light è `config:` in `values.yaml`,
reso in una ConfigMap e montato in sola lettura; i riferimenti `${VAR}` al suo
interno si risolvono contro quello stesso Secret. Una modifica fa ruotare il pod,
perché una ConfigMap montata che cambia su disco non riavvia nulla da sola.
