[← README](../README.it.md)

## 4. Docker

### 4.1 Immagini e target di build

Un solo `Dockerfile`, quattro stage. `builder` compila tutto una volta sola;
`light` e `ui` sono le due immagini di runtime distribuite; `dev` esiste solo per
lo [sviluppo live](development.it.md#93-sviluppo-live) e non viene mai costruito da
`docker compose --profile ui up`.

```
builder  node:26-alpine   npm ci (con le devDependencies), tsc, vite build, copia in dist gli asset non-TS
light    node:26-alpine   dipendenze prod + dist/{core,adapters,notifiers,light,outpost}
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
il core sono condivisi su disco e in un registry.

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
| Porte | nessuna | `127.0.0.1:3000:3000` |
| Healthcheck | età di `state.json` — ogni ciclo lo riscrive, tre intervalli senza scritture è unhealthy | `GET /ready` |
| Start period | 40s | 60s |
| Utente | `node`, non privilegiato | `node`, non privilegiato |

Il servizio `ui` pubblica `:3000` solo sul loopback dell'host: la dashboard non ha
login se `API_TOKEN` non è impostato, quindi per impostazione predefinita solo questa
macchina può raggiungerla. Per aprirla alla LAN, cambia il lato sinistro della
mappatura in `docker-compose.yml` in `0.0.0.0:3000` **e** imposta `API_TOKEN` (vedi
[`BIND_HOST` e `API_TOKEN`](configuration.it.md#312-raggiungere-lapi-da-un-altro-host)).
Dentro il container il server ascolta su `0.0.0.0` (`BIND_HOST`), perché la porta
pubblicata arriva sull'interfaccia del container stesso.

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

### 4.5 Nessuno dei due: l'edizione Light in un solo file

> **Deprecata dalla 2.46, non più pubblicata dalla 3.0** ([Deprecazioni](deprecations.it.md)):
> usa l'immagine container della Light. Fino ad allora il binario scrive un
> avviso nel log a ogni avvio.

Chi non vuole né Docker né un'installazione di Node può eseguire l'edizione
Light come un unico eseguibile — roadmap 6.7. Ogni release lo allega accanto
alle immagini, con un checksum:

```bash
gh release download vX.Y.Z --pattern 'isitdown-light-*-linux-x64*'
sha256sum -c isitdown-light-vX.Y.Z-linux-x64.sha256
chmod +x isitdown-light-vX.Y.Z-linux-x64
CONFIG_PATH=./config.yml DATA_PATH=./state.json ./isitdown-light-vX.Y.Z-linux-x64
```

È la stessa edizione, con lo stesso `config.yml` e le stesse variabili
d'ambiente — qui i due percorsi non hanno un default `/app` su cui ricadere,
quindi conviene impostarli entrambi. Per costruirne uno in locale basta
`npm run build:sea`, che scrive `dist/sea/isitdown-light`.

Solo Light, deliberatamente: l'edizione UI serve una dashboard compilata da
`dist/ui/public`, cioè migliaia di file che un binario dovrebbe portarsi dietro
e di cui un operatore dovrebbe essere informato. Il file pesa circa 120MB, quasi
tutti Node stesso — è la forma di un single executable di Node, non un segnale
che qualcosa sia andato storto — ed è costruito con la versione di Node in
`.nvmrc`. Per ora Linux x64; macOS e Windows richiedono un runner ciascuno, da
aggiungere quando qualcuno lo chiede e non prima.

I cataloghi delle notifiche viaggiano dentro il binario come asset SEA, quindi
non serve nient'altro accanto: il file di configurazione e un posto dove tenere
lo stato.

### 4.6 Unraid e Home Assistant

Distribuzione più che funzionalità (roadmap 6.6): entrambe raggiungono un
pubblico che fa girare esattamente questo tipo di container, e nessuna delle due
cambia una riga dell'applicazione.

**Unraid.** `deploy/unraid/isitdown-ui.xml` e `deploy/unraid/isitdown-light.xml`
sono template Community Applications per le due immagini pubblicate. Aggiungi il
template sotto **Docker → Add Container → Template repositories**, oppure punta
l'URL al file raw. Ciascuno porta con sé la porta, i percorsi e una variabile
mascherata per ogni credenziale di canale, così il form pone le stesse domande a
cui risponde il compose — una porta e un volume dati per l'edizione UI, un
`config.yml` in sola lettura e un volume dati per quella Light.

**Home Assistant.** `deploy/homeassistant/isitdown/` è un add-on per l'edizione
UI. Il Supervisor scopre un repository di add-on dalla radice di un repository
Git e questo è una cartella dentro un progetto, quindi si installa come add-on
locale: copia la cartella nella share `addons`, poi **Impostazioni → Add-on →
Add-on store → ⋮ → Controlla aggiornamenti**. Sovrappone un solo file a
`ghcr.io/devmanfre/isitdown:ui-latest` invece di ricostruire qualcosa, quindi
installarlo costa un `docker pull`.

Due decisioni da conoscere prima di installarlo:

- **Pubblica una porta invece di usare l'ingress.** L'ingress serve un add-on
  sotto un prefisso di percorso generato, e la dashboard è costruita contro uno
  assoluto — il suo bundle e le sue chiamate API partono entrambi da `/`. Un
  pannello si aprirebbe su una pagina bianca, che è peggio di un link.
- **Solo le credenziali sono opzioni dell'add-on.** Tutto il resto si imposta
  nella dashboard, perché l'edizione UI tiene l'intera configurazione in SQLite.
  I nomi delle opzioni sono i nomi delle variabili che i canali chiedono, così la
  riga "env mancante" della dashboard e la pagina di configurazione dell'add-on
  dicono la stessa parola. Il database vive in `/data`, il volume persistente
  dell'add-on, che è ciò che un backup di Home Assistant si porta dietro.

L'edizione Light non ha un add-on. Non ci sarebbe una pagina da aprire in Home
Assistant, il che rende un container semplice il modo migliore di eseguirla.

### 4.7 Outpost — un secondo punto di vista per le sonde

Una sonda che fallisce dice "non raggiungibile *dalla rete di questo
container*", che non è lo stesso di "down": un router di casa che perde una
rotta sembra identico al servizio che sparisce. Un **outpost** (roadmap 1.7) è
un secondo punto di osservazione: un container senza stato su un'altra rete —
una piccola VPS, una seconda sede — che esegue una sonda quando glielo si chiede
e risponde con ciò che ha visto. Il poller interroga ogni outpost insieme alla
propria lettura e tiene ciò su cui concorda la maggioranza
([come funziona §7.10](how-it-works.it.md#710-outpost-e-consenso)).

È l'immagine Light con un comando suo, quindi non c'è una terza immagine da
scaricare:

```bash
# On the VPS: the outpost listens on :8080 and refuses to start without a token
echo "OUTPOST_TOKEN=$(openssl rand -hex 32)" > .env
docker compose --profile outpost up -d

# On the main instance (either edition), the same token and every outpost's URL
OUTPOSTS=https://vps-1.example.com:8080,https://vps-2.example.com:8080
OUTPOST_TOKEN=<the token above>
```

- **È l'istanza principale a chiedere; l'outpost non chiama mai casa.**
  L'istanza principale di solito sta dietro NAT e l'edizione Light non ha alcun
  server, quindi è l'outpost a restare in ascolto. Non tiene nemmeno
  configurazione: ogni richiesta porta con sé l'intera sonda, così un outpost
  può servire più installazioni e un restart non perde nulla.
- **Solo sonde.** Vengono inviati gli adapter di sonda (`http`, `tcp`, `dns`, …); una pagina di stato si
  legge uguale da qualunque posto, quindi non lo è mai. L'outpost rifiuta ogni
  altro adapter, e questo gli impedisce anche di diventare un fetcher generico
  per chiunque abbia il token.
- **Mettici davanti il TLS.** Il token viaggia in un header `Authorization` e le
  opzioni della sonda nel body, quindi un outpost raggiungibile da internet va
  dietro un reverse proxy che termina HTTPS, o su una rete privata (WireGuard,
  Tailscale).
- **Opt-in, e mai d'intralcio.** Con `OUTPOSTS` non impostata non cambia nulla.
  Un outpost spento, lento o configurato male si astiene — registrato come
  `outpost did not answer` e nominato nella nota diagnostica del provider — e
  non conta mai come voto "down".

### 4.8 Un database che non si apre

Lo stato dell'edizione UI è un unico file SQLite, `/app/data/isitdown.db`, e
un'interruzione di corrente a metà scrittura è il guasto più normale di un
homelab. Il database è aperto in modalità WAL con `synchronous = FULL`, quindi un
ciclo che ha fatto commit sopravvive all'interruzione; può ancora succedere che
il disco strappi una pagina. Ogni avvio esegue `PRAGMA quick_check` prima di
scrivere qualsiasi cosa, e un file che non lo supera ferma l'avvio: il container
esce con codice 1 e stampa su stderr cosa ha trovato SQLite, il percorso e i tre
passi qui sotto — mai uno stack trace, e il file danneggiato resta esattamente
com'era.

Per ripartire con Docker Compose, usando il backup più recente scaricato dalla
dashboard (Impostazioni → Dati → Backup del database → Scarica il database, un
file chiamato `isitdown-<data>.db`, qui nella directory corrente):

```bash
docker compose --profile ui stop ui
# Metti da parte il file danneggiato e i suoi -wal/-shm, poi il backup al suo posto.
# Il -wal deve andarsene con lui: lasciato lì, verrebbe riapplicato al backup.
docker compose --profile ui run --rm --no-deps -v "$PWD:/restore:ro" --entrypoint sh ui -c '
  cd /app/data && mkdir -p damaged && mv isitdown.db* damaged/ &&
  cp /restore/isitdown-2026-11-14.db isitdown.db'
docker compose --profile ui start ui
```

Un backup più vecchio viene portato allo schema attuale all'avvio, come fa un
ripristino dalla dashboard. Due cose che un backup non copre:

- **Le righe scritte dopo.** `sqlite3 damaged/isitdown.db .recover > recovered.sql`,
  eseguito su una copia del file danneggiato, recupera ciò che SQLite riesce
  ancora a leggere; vale un'occhiata prima di buttare il file.
- **`secrets.env`.** Le credenziali dei canali stanno accanto al database, non
  dentro ([3.4](configuration.it.md#34-come-vengono-gestiti-i-segreti)), quindi nulla di quanto sopra le tocca.

Senza alcun backup, ripartire col file danneggiato messo da parte inizia un
database vuoto: i provider si aggiungono di nuovo dalla dashboard o importando un
`config.yml`.

### 4.9 Inviluppo di risorse — quanto costa un parco provider

"Gira sul mio Raspberry Pi?" — misurato, non stimato. `npm run
measure:envelope` ([9.4](development.it.md#94-test-e-controlli)) avvia entrambe le
edizioni, compilate, contro un finto Statuspage locale con tre dimensioni di
parco provider, e stampa questa tabella:

Measured on 2026-11-21, IsItDown v2.46.1, Node 26.13.1, 13th Gen Intel(R) Core(TM) i7-1355U (6 threads), 10 GB RAM.
Providers served by a local fake Statuspage (all operational), 2,000+ samples per size;
growth extrapolated at the default 3-minute interval.

| Edition | Providers | Startup to ready | Memory (RSS) | CPU per cycle | Cycle duration | Database after startup | Database per provider per month |
|---|--:|--:|--:|--:|--:|--:|--:|
| Light | 10 | 198 ms | 202 MB | 12 ms | 9 ms | — | — (state file) |
| UI | 10 | 18.3 s | 267 MB | 17 ms | 47 ms | 38.5 MB | 1.5 MB |
| Light | 100 | 444 ms | 255 MB | 158 ms | 137 ms | — | — (state file) |
| UI | 100 | 27.9 s | 255 MB | 80 ms | 271 ms | 392.1 MB | 1.5 MB |
| Light | 500 | 2.8 s | 304 MB | 1.6 s | 1.5 s | — | — (state file) |
| UI | 500 | 74.7 s | 296 MB | 386 ms | 1.4 s | 2030.3 MB | 1.5 MB |

Il blocco è l'output dello script, lasciato in inglese perché si rigenera così
com'è. Come leggerlo:

- **Memoria**: è la memoria residente dopo almeno cento cicli, quando ha
  smesso di salire. Gran parte è ciò che V8 e l'allocatore tengono in riserva:
  l'heap JavaScript vero e proprio resta intorno ai 20 MB a 10 provider.
  Conviene prevedere circa 300 MB per edizione. Entrambe le edizioni stanno su
  una scheda da 1 GB.
- **CPU per ciclo**: è il lavoro di IsItDown contro un provider su loopback. Un
  parco reale aggiunge i round trip di rete alla *durata* del ciclo, non alla
  sua CPU. Anche il valore peggiore, 1,6 s ogni 3 minuti, sta sotto l'1% di un
  core. Il costo dell'edizione Light cresce più in fretta del parco perché
  riscrive l'intero file di stato JSON a ogni modifica.
- **Avvio**: per l'edizione UI è soprattutto storia. Per un provider mai visto
  ricostruisce 90 giorni di campioni dal suo elenco di incidenti prima di
  registrare il primo ciclo, e `/ready` risponde 200 solo dopo quel ciclo. Un
  riavvio con la storia già presente è più veloce. L'edizione Light non tiene
  storia, quindi è pronta dopo un ciclo.
- **Database**: la ricostruzione è il motivo per cui un nuovo parco parte da
  circa 4 MB per provider. Da lì cresce di 1,5 MB per provider al mese e si
  stabilizza alla retention (120 giorni di default): circa 6 MB per provider,
  quindi ~60 MB per 10 provider, ~600 MB per 100 e ~3 GB per 500. Abbassare la
  retention nelle Impostazioni riduce il totale in proporzione. Le letture
  complete del replay sono un costo fisso in più, al massimo 100 per provider.
  L'edizione Light scrive un piccolo file di stato JSON.

### 4.10 Proxy e reti senza Internet

**Dietro un proxy.** Imposta le solite variabili sul container. Da quel
momento ogni richiesta HTTP di IsItDown passa dal proxy: pagine di stato,
canali di notifica, controllo aggiornamenti, catalogo, heartbeat
([3.39](configuration.it.md#339-ping-in-uscita--il-dead-mans-switch-di-isitdown)).
Gli host in `NO_PROXY` vengono raggiunti direttamente. Funzionano sia le
maiuscole sia le minuscole, e le credenziali possono stare nell'URL
(`http://utente:password@proxy:3128`). All'avvio il log dice una volta quale
proxy è in uso, senza la credenziale.

```yaml
services:
  isitdown:
    environment:
      HTTPS_PROXY: http://proxy.corp:3128
      HTTP_PROXY: http://proxy.corp:3128
      NO_PROXY: localhost,127.0.0.1,.lan,10.0.0.0/8
```

Da sapere:

- **Metti la tua LAN in `NO_PROXY`.** Senza, anche una richiesta a `nas.lan`
  o a un outpost sulla LAN va al proxy, come farebbe `curl`.
- **I controlli TCP, ping, DNS e IMAP non usano il proxy**: un proxy porta
  solo HTTP. Si collegano direttamente dal container.
- **La policy di uscita ([3.38](configuration.it.md#338-la-policy-di-uscita--cosa-può-raggiungere-una-sonda))
  giudica sempre la destinazione, non il proxy.** Una differenza: un nome
  host che questo container non sa risolvere viene passato al proxy invece di
  essere rifiutato, perché in una rete chiusa spesso solo il proxy risolve i
  nomi pubblici.
- **L'healthcheck del container** parla con `localhost` e non passa mai dal
  proxy.

**Senza nessuna uscita.** IsItDown continua a funzionare per tutto ciò che
riesce a raggiungere: servizi sulla LAN, controlli TCP e ping, canali di
notifica interni alla rete (un webhook, Mattermost, un ntfy o Gotify locale).
Ciò che ha bisogno di Internet degrada in silenzio, senza un errore nel log a
ogni ciclo:

| Funzione | Senza Internet |
|---|---|
| Pagine di stato pubbliche (GitHub, Cloudflare…) | Lette come fallite, come in qualunque disservizio. Non aggiungerle. |
| Icone dei provider nella dashboard | Il browser non riesce a caricarle; ogni riquadro tiene l'etichetta di tre lettere. |
| Font della dashboard (Google Fonts) | Il browser ripiega sul font di sistema. |
| Catalogo remoto dei provider | Si usa il catalogo incluso nell'immagine. Gli errori vanno solo nel log `debug`. |
| Controllo aggiornamenti | Nessun avviso di nuova versione. Gli errori vanno solo nel log `debug`. |
| Web push | Serve il servizio push del produttore del browser, quindi l'invio fallisce e compare nel registro delle consegne, come per ogni canale che non riesce a inviare. |
| Riassunti degli incidenti con l'IA | Serve l'API del fornitore del modello; i riassunti non vengono scritti. |

### 4.12 Aggiornare e tornare indietro

Ogni aggiornamento che cambia lo schema del database prima copia il file in
`/app/data/backups/pre-v<schema>.db`, poi lo aggiorna in una sola transazione.
Se la copia non si può fare — un disco pieno — l'aggiornamento non parte.

Un'immagine più vecchia avviata su un database che una più nuova ha aggiornato
si rifiuta di partire, prima di scrivere qualsiasi cosa: tornare indietro è
un'operazione normale, e una build vecchia che legge uno schema che non conosce
potrebbe scrivere righe di cui la nuova non può fidarsi. Esce con codice 1 e
dice, su stderr, a che schema è il file, quale IsItDown l'ha scritto e le
strade possibili. Sono due.

**Riportare indietro lo schema, tenendo i dati.** Con l'immagine *più nuova* —
l'unica che sa cosa hanno fatto i suoi passi — esegui `--migrate-down` con lo
schema che conosce quella più vecchia (il rifiuto lo nomina), poi avvia
l'immagine più vecchia:

```bash
docker compose --profile ui stop ui
docker compose --profile ui run --rm --no-deps ui node dist/ui/server.js --migrate-down 41
# ora fissa il tag più vecchio in compose.yml e avvialo
docker compose --profile ui up -d
```

Copia prima il file in `backups/pre-down-v<schema>.db`, poi toglie quello che
lo schema più nuovo ha aggiunto — colonne e tabelle, con le righe dentro — in
una sola transazione. Tutto ciò per cui lo schema più vecchio ha un posto
resta. Alcuni passi vecchi non si possono annullare (uno ha svuotato le
iscrizioni web-push): `--migrate-down` si ferma al più recente di questi e dice
fin dove può arrivare.

**Oppure rimettere la copia pre-aggiornamento.** `backups/pre-v<schema>.db` è
il database esattamente come l'ha lasciato la versione più vecchia.
Ripristinalo come [4.8](#48-un-database-che-non-si-apre) ripristina un backup;
quello che è stato registrato dopo l'aggiornamento non c'è.
