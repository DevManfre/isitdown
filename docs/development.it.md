[← README](../README.it.md)

## 9. Sviluppo

### 9.1 Struttura del repository

```
isitdown/
├── src/
│   ├── core/                          (condiviso dalle due edizioni)
│   │   ├── types.ts                   NormalizedStatus, Incident, StatusChange, NotificationPayload
│   │   ├── adapter.interface.ts       ServiceRef, FetchContext, Adapter
│   │   ├── notifier.interface.ts      Notifier
│   │   ├── stateStore.interface.ts    ProviderRuntimeState, StateStore
│   │   ├── configSource.interface.ts  RuntimeConfig, ServiceDefinition, ChannelConfig, ConfigSource
│   │   ├── config.schema.ts           schemi zod condivisi dal loader su file e dalle scritture della UI
│   │   ├── status.schema.ts           validazione di un NormalizedStatus persistito
│   │   ├── poller.ts                  un ciclo: sfasamento, retry, isolamento, conteggio fallimenti
│   │   ├── groups.ts                  gruppi di provider: lo stato composito di un gruppo (§3.10)
│   │   ├── diffEngine.ts              l'unica autorità su se una notifica scatta
│   │   ├── notificationDispatcher.ts  l'unico chiamante di Notifier.send
│   │   ├── scheduler.ts               il loop; rilegge la configurazione a ogni ciclo
│   │   ├── http.ts                    l'unica lettura HTTP: rivalidazione ETag/Last-Modified, decodifica del charset
│   │   ├── logger.ts
│   │   └── i18n/                      stringhe delle notifiche, indipendenti dall'edizione
│   │       ├── index.ts               lookup + fallback su en + formattazione UTC
│   │       ├── en.json                lingua di partenza
│   │       └── it.json
│   ├── adapters/                      (condiviso)
│   │   ├── catalog.ts                 catalogo di provider noti incluso
│   │   ├── statuspage.adapter.ts      adapter generico Atlassian Statuspage
│   │   ├── rss.adapter.ts             adapter generico per feed RSS / Atom
│   │   ├── slack.adapter.ts           l'API di stato di Slack
│   │   ├── aws.adapter.ts             il feed degli eventi aperti di AWS Health, per regione
│   │   ├── gcp.adapter.ts             incidents.json di Google Cloud: stato e cronologia in uno
│   │   ├── azure.adapter.ts           il feed di stato di Azure, col suo vocabolario di chiusura
│   │   └── index.ts                   registro per id di adapter
│   ├── notifiers/                     (condiviso)
│   │   ├── formatting.ts              emoji, colori, etichette di severità, composizione del messaggio
│   │   ├── settings.ts                validazione condivisa per i canali configurati con un solo URL
│   │   ├── telegram.notifier.ts
│   │   ├── webhook.notifier.ts
│   │   └── index.ts                   registro per id di canale
│   ├── light/                         (solo edizione Light)
│   │   ├── index.ts                   entrypoint
│   │   ├── runtime.ts                 wiring, condiviso col test end-to-end
│   │   ├── healthcheck.ts             freschezza del file di stato
│   │   ├── check.ts                   validazione di config.yml, CI-abile (§3.9)
│   │   ├── fileStateStore.ts          file JSON, scritture atomiche
│   │   └── config/
│   │       ├── schema.ts              forma di config.yml
│   │       ├── loadConfig.ts          YAML + sostituzione ${ENV} + validazione
│   │       └── checkConfig.ts         tutti i problemi in una volta, non il primo
│   └── ui/                            (solo edizione UI)
│       ├── server.ts                  entrypoint
│       ├── runtime.ts                 wiring, condiviso coi test delle API
│       ├── app.ts                     app Express: route, dashboard statica, errori JSON
│       ├── routePaths.ts              la tabella delle route della dashboard, condivisa col router client
│       ├── healthcheck.ts             interroga /health
│       ├── sqliteStateStore.ts        StateStore + cronologia, una transazione per salvataggio
│       ├── historyStore.interface.ts  il contratto della cronologia (la UI ne è l'unico consumatore)
│       ├── history.ts                 aggregazione di uptime e incidenti
│       ├── backfill.ts                ricostruisce 90 giorni di storico dagli incidenti di un provider al primo avvio
│       ├── dbConfigSource.ts          configurazione da SQLite; risolve i segreti per nome di variabile
│       ├── secretsFile.ts             credenziali salvate dalla dashboard: file 0600 accanto al database, applicate all'ambiente
│       ├── metrics.ts                  la superficie di scrape Prometheus: gauge dallo store, counter in memoria
│       ├── configFile.ts             export / import di config.yml (§4.3)
│       ├── db/                        open.ts, migrate.ts, seed.ts
│       ├── routes/                    status, history, incidents, export, notifications, config, preferences, metrics
│       └── web/                       la dashboard: react, vite, shadcn/ui
│           ├── index.html             script del tema pre-paint, font, #root
│           ├── main.tsx               albero dei provider: i18n, query, tema, router
│           ├── App.tsx                shell della console: rail, header, contenitore delle viste
│           ├── routes.tsx             route con hash
│           ├── components/ui/         primitive shadcn
│           ├── components/            rail, header, indicatore di polling, charts/
│           ├── views/                 overview, providers, incidents, incident,
│           │                          history, log invii, settings
│           ├── hooks/                 queries, theme, rail, busy
│           ├── lib/                   api, types, chartConfig, format, i18n
│           ├── css/base.css            punto di ingresso Tailwind: importa tailwindcss, tokens, motion
│           ├── css/tokens.css         l'unico file con un colore letterale
│           ├── css/motion.css         keyframes, animazioni d'ingresso, transizioni
│           └── locales/               en.json (sorgente) + it.json
├── tools/
│   ├── copy-assets.mjs                copia in dist i cataloghi i18n e delle lingue della dashboard (il
│   │                                   bundle della dashboard è già output di Vite, non di questo script)
│   └── readme-parity.mjs              README.md contro ogni README.<lang>.md (npm run check:readme)
├── test/
│   ├── core/                          diff engine, poller, scheduler, dispatcher, i18n, schemi
│   │   └── stateStore.contract.ts     una suite che ogni implementazione di StateStore deve passare
│   ├── adapters/
│   ├── notifiers/
│   ├── light/
│   ├── ui/                            contratto dello store, aggregazione, ogni route API, guardie tema e lingue
│   ├── fixtures/statuspage/           payload registrati dalle pagine vere, mai scaricati in un test
│   ├── helpers/
│   └── integration/                   *.itest.ts — provider finto e ricevitore webhook end to end
├── docs/grafana/isitdown.json         la dashboard Grafana committata per /metrics
├── design/                            prototipi Claude Design (in .gitignore: su disco, non in un clone)
├── Dockerfile                         builder → light → dev → ui (dev è FROM builder; ui è FROM light)
├── docker-compose.yml                 entrambe le edizioni come profili
├── docker-compose.dev.yml             override di sviluppo: edizione UI live da src/, Vite ricompila il bundle in watch
├── config.example.yml                 template versionato; config.yml è in .gitignore
├── .env.example                       nomi delle variabili dei segreti, mai valori
├── .nvmrc  .npmrc                     fissano Node 24 e fanno fallire in modo esplicito una versione più vecchia
├── tsconfig.json                      TypeScript del server
├── tsconfig.light.json                la build Light: esclude src/ui
├── tsconfig.web.json                  la dashboard: lib DOM + react-jsx
├── vite.config.ts                     bundle, proxy di sviluppo, config di vitest
└── components.json                    configurazione della CLI shadcn
```

I test dei componenti e degli hook della dashboard vivono insieme al codice sotto
`web/`, come `*.test.tsx` accanto a ciò che testano, e sono raccolti da lì da
Vitest — il resto dell'albero segue la convenzione `test/` di sopra.

**Regola d'oro:** `src/core`, `src/adapters` e `src/notifiers` non importano mai da
`src/light` o `src/ui`. Il comportamento specifico dell'edizione viene iniettato
attraverso le interfacce condivise. Un test lo impone, comprese le dipendenze
esclusive di un'edizione.

### 9.2 Stack tecnologico

| Livello | Scelta | Note |
|---|---|---|
| Runtime | Node.js 24 | Obbligatorio: servono sia il driver SQLite integrato sia lo strip nativo dei tipi TypeScript. |
| Linguaggio | TypeScript, strict | Più `erasableSyntaxOnly` e `rewriteRelativeImportExtensions`, così `tsc` emette `.js` reali mentre `node --test` esegue direttamente i sorgenti `.ts`. |
| Client HTTP | `fetch` globale | Già nel runtime. |
| Scheduling | `setTimeout`, riarmato con jitter | Un ciclo lento ritarda il successivo invece di sovrapporsi. |
| Storage | file JSON (Light) · `node:sqlite` integrato (UI) | Nessun modulo nativo, quindi nessun compilatore in alcuno stage di build. |
| Validazione | `zod` | Ogni input esterno: file di configurazione, payload dei provider, righe del database, cataloghi. |
| Parsing configurazione | `yaml` | |
| Test runner | `node:test` integrato, più Vitest | `node:test` esegue server, core, adapter, notifier e le guardie basate su filesystem direttamente da `.ts`; Vitest e React Testing Library coprono `src/ui/web/`, perché lo strip dei tipi di Node non trasforma JSX. |
| Dashboard | React 19 + Vite + Tailwind v4 + shadcn/ui | Incorporata nel bundle in `dist/ui/public`; le primitive Radix sono tematizzate interamente da `tokens.css`. |
| Charts | Recharts, tramite il wrapper `chart` di shadcn | I dati restano aggregati lato server; il client non deriva mai una percentuale. |
| Client routing | `react-router` 8, basato su hash | Il routing basato su percorso non era disponibile: `/incidents/:providerId/:incidentId` è già un endpoint API. |
| Client i18n | `react-i18next` | Cataloghi piatti, interpolazione a parentesi singola, incorporati nel bundle invece che recuperati via fetch. |
| Server state | TanStack Query | `refetchInterval` di 30 secondi, refetch al focus, sospeso mentre un dialogo o un campo è in uso. |
| Container | un `Dockerfile` multi-stage | `--target light` / `--target ui`, `node:24-alpine`. |

Dipendenze a runtime, in modo esaustivo: `zod`, `yaml` (entrambe le edizioni) ed
`express` (UI). Tutto ciò che la dashboard usa — React, Vite, Tailwind, le
primitive Radix di shadcn/ui, TanStack Query, react-i18next, Recharts e il resto —
è una devDependency compilata in asset statici al momento della build, così
l'immagine `ui` guadagna un bundle, non un albero di dipendenze. Dipendenze di
sviluppo per il resto: `typescript`, `@types/node`, `@types/express`,
`@types/react`, `@types/react-dom`, i plugin di Vite, Vitest e React Testing
Library.

### 9.3 Sviluppo live

Due modalità, per due cicli diversi:

```bash
npm run dev:ui       # locale: Express su :3000, dev server di Vite su :5173 con HMR
npm run dev:docker   # container: Vite ricompila in watch su dist/, Express serve :3000
```

`dev:ui` esegue server e Vite come due processi locali insieme (`concurrently`).
Il browser parla con Vite su **5173** — è lì che vive l'HMR — e il proxy del dev
server di Vite instrada ogni percorso API (`/status`, `/config`, `/history`,
`/incidents`, `/notifications`, `/poll`, `/api`, `/health`, `/ready`) verso il vero server
Express su 3000. Visitare direttamente la :3000 serve invece quel che già si trova
in `dist/ui/public`, che non è live.

`dev:docker` è la modalità fedele: una sola porta, lo stesso URL e la stessa porta
che userebbe un operatore, nulla in mezzo — è questo che rende significativi anche
contro di essa i controlli rapidi di [5.1](verifying.it.md#51-controlli-rapidi).
`docker-compose.dev.yml` sovrascrive il servizio `isitdown-ui` per costruire il
target `dev` (taggato `isitdown:dev`, mai `isitdown:ui`), monta `./src`,
`vite.config.ts` e `tsconfig.web.json` in sola lettura, ed esegue `npx vite build
--watch & exec node --watch src/ui/server.ts` — Vite riscrive il bundle in
`dist/ui/public` a ogni modifica del sorgente, in background, e l'unico processo
Express su :3000 serve sempre quel che Vite ha scritto per ultimo.

`WEB_DIR` deve essere impostata esplicitamente in ogni modalità di sviluppo,
locale o containerizzata: il valore predefinito del server (in `app.ts`,
`./public/` relativo a se stesso) si risolve correttamente solo quando il modulo
gira da `dist/ui/`, dove finisce davvero la build di Vite. Eseguire direttamente
il modulo *sorgente* — esattamente quel che fa la modalità di sviluppo — fa
risolvere quello stesso predefinito accanto a `src/ui/`, dove non esiste più nulla
chiamato `public/`: il sorgente della dashboard ora vive sotto `src/ui/web/`. Sia
lo script npm di `dev:ui` che `docker-compose.dev.yml` impostano `WEB_DIR` sul
percorso costruito `dist/ui/public` esplicitamente per questo motivo.

| Modifica | `dev:ui` | `dev:docker` |
|---|---|---|
| `.tsx`, `.ts` o CSS sotto `web/` | HMR, nessun reload | ricompila in circa un secondo, poi hard refresh |
| un JSON di lingua sotto `web/locales/` | HMR | ricompila, hard refresh |
| un qualsiasi `.ts` del server | `node --watch` riavvia | `node --watch` riavvia |
| una dipendenza in `package.json` | `npm install` (poi restart) | `npm run dev:docker -- --build` |
| il `Dockerfile` | nessun effetto — `dev:ui` non tocca mai Docker | `npm run dev:docker -- --build` |

Una ricompilazione cambia il nome del file del bundle, non solo il suo contenuto —
i nomi degli asset sono content-hashed — quindi "hard refresh" basta in ogni caso:
l'`index.html` appena scritto punta sempre al nuovo hash, e non c'è un caso di
cache stantia da gestire come eccezione.

Due cose che la modalità di sviluppo non fa. Non esegue il type-check — rimuovere i
tipi non è compilarli, quindi `npm run typecheck` resta obbligatorio. E il `dist/`
di nessuna delle due modalità è quello che va in produzione: il rilascio passa
comunque dalla via normale,

```bash
docker compose --profile ui up -d --build   # si torna all'immagine costruita
```

Per distinguere la modalità di un container in esecuzione: `docker compose ps`
mostra `ghcr.io/devmanfre/isitdown:ui-latest` per l'immagine costruita e
`isitdown:dev` per la modalità di
sviluppo; `docker inspect -f '{{.Config.Cmd}}' isitdown-ui` mostra
`node dist/ui/server.js` per l'immagine costruita, e `sh -c "npx vite build
--watch & exec node --watch src/ui/server.ts"` per la modalità di sviluppo.

### 9.4 Test e controlli

```bash
npm test                 # suite node:test + vitest run
npm run coverage         # le stesse due suite sotto una soglia minima di copertura
npm run test:integration # suite end-to-end:  test/**/*.itest.ts
npm run test:visual      # baseline visive: ogni vista, entrambi i temi, entrambe le lingue
npm run check:bundle     # la dashboard compilata contro il suo budget di dimensione gzip
npm run check:readme     # questo file contro ogni README.<lang>.md
npm run typecheck        # tsconfig del server + tsconfig della dashboard (tsconfig.web.json)
npm run build:light      # tsc + copia asset, escludendo src/ui
npm run build:ui         # tsc + vite build + copia asset
```

Il budget del bundle (roadmap 5.16) pesa ciò che `build:ui` ha prodotto, in
gzip, perché è quello che il browser scarica: `410 kB` di JavaScript e `20 kB` di
CSS, entrambi poco sopra la build di oggi. È un tetto, non un obiettivo — quando
fallisce la risposta è trovare cosa è cresciuto, non alzare il numero.

La soglia di copertura (roadmap 7.2) è un pavimento, non un obiettivo da
rincorrere. Sono due, perché le due suite coprono metà diverse: il server e il
motore devono restare al 95% delle righe, all'88% dei rami e al 93% delle
funzioni, e la dashboard a 85/75/80 — ciascuna qualche punto sotto il valore
attuale, così il movimento ordinario passa e un sottosistema nuovo che arriva
senza test propri trascina il totale sotto la soglia e fa fallire la CI. Alza una
soglia quando la suite è davvero salita; non abbassarne mai una per far tornare
verde una run rossa.

**Nessun test raggiunge mai un provider reale.** Gli adapter sono testati contro
payload registrati dalle status page vere e conservati sotto `test/fixtures/`; il
comportamento HTTP gira contro un server locale.

Suite notevoli:

- **Diff engine** — l'intera tabella di [7.3](how-it-works.it.md#73-quando-scatta-una-notifica),
  compresi tutti i casi che **non** devono notificare.
- **Contratto dello state store** — una sola suite, eseguita invariata su entrambe le
  implementazioni, così sono dimostrabilmente interscambiabili. Include il caso del
  restart.
- **Poller** — numero di tentativi e backoff crescente, isolamento per provider, un
  provider appeso che non blocca uno sano, e l'avviso di monitoraggio che scatta una
  volta sola.
- **Scheduler** — timer simulati e jitter iniettato: cadenza, rilettura della
  configurazione per ciclo, un poll manuale che si aggancia a un ciclo in corso, un
  ciclo fallito che non uccide il loop.
- **Notifier** — forma della richiesta in uscita per transizione, e la verifica che un
  invio Telegram fallito non metta mai il token nel proprio errore.
- **API** — ogni route contro un server reale su un database temporaneo, inclusa la
  verifica che nessun body di risposta contenga un valore dell'ambiente.
- **Guardie su tema e lingue** — nessun esadecimale fuori dal file dei token (la
  scansione cattura anche un esadecimale infilato in un valore arbitrario di
  Tailwind, ad es. `bg-[#1a1a2e]`), un'asserzione di parità dei token semantici
  che verifica che ogni variabile shadcn si risolva in un `var()` della palette e
  sia dichiarata identica in tutti e tre i blocchi tema, parità dei cataloghi, ogni
  chiave `t()` che si risolve, e una scansione per una frase inglese digitata
  direttamente nel JSX — un'euristica, deliberatamente più debole della scansione
  esatta sui nodi di testo che ha sostituito, perché il JSX non offre un modo
  privo di parsing per distinguere un'espressione tradotta da un letterale.
- **Regressione visiva** — ogni vista fotografata in entrambi i temi ed entrambe
  le lingue su una flotta fissa e con l'orologio congelato, poi confrontata con
  le baseline concordate sotto `test/visual/baseline/`. Il confronto avviene su
  una riduzione 8× di entrambi i frame, ed è questo che permette a un solo set di
  baseline di valere su più macchine: la rasterizzazione dei font non è
  portabile, e la stessa pagina sul runner della CI differisce da quella locale
  fino all'1,5% dei pixel solo lungo i bordi del testo. Mediato via quel rumore
  restano i due criteri che contano — quante celle si sono spostate (un cambio di
  layout) e quante hanno cambiato colore del tutto (un cambio di token) — con
  limiti misurati sia sul rumore cross-macchina sia su regressioni reali, non
  scelti a intuito. Chromium arriva dalla cache di Playwright e viene pilotato
  via DevTools protocol, quindi nulla importa il pacchetto e resta fuori da
  `package.json`. `node tools/visual-regression.mjs --update` accetta un cambio
  voluto, `--only=<vista>` serve mentre si itera su una sola.
- **Parità delle traduzioni del README** — lo scheletro delle intestazioni
  numerate, il numero di intestazioni per livello, di blocchi di codice e di
  righe di tabella, e gli identificatori (route, nomi di variabili in
  maiuscolo, script npm) che ogni file nomina, confrontati fra `README.md` e
  ogni `README.<lang>.md`. Solo struttura, mai significato: un identificatore in
  una traduzione si copia tale e quale, quindi uno che compare in un solo file è
  o una sezione mai portata o un flag che qualcuno ha tradotto. La CI lo esegue,
  così una modifica finita in uno solo dei due file non può arrivare su `main`.
- **End to end** — un provider finto e un ricevitore webhook: una transizione consegna
  esattamente una notifica, un ciclo invariato nessuna, un restart nessuna, un provider
  irraggiungibile conserva l'ultimo stato noto, e l'entrypoint resta vivo tra i cicli e
  esce con 0 su `SIGTERM`.

La dashboard è ora TypeScript vero, verificato dal proprio `tsconfig.web.json`
invece che da un passaggio guidato da JSDoc su JavaScript puro; i suoi componenti e
hook sono testati con Vitest e React Testing Library, collocati come `*.test.tsx`
accanto a ciò che coprono.

### 9.5 Convenzioni

- Validare ogni input esterno con `zod` al confine; fidarsi dell'interno.
- Un adapter per file sotto `src/adapters/`, un notifier per file sotto
  `src/notifiers/`, ciascuno che implementa l'interfaccia condivisa.
- La logica di invio delle notifiche vive solo sul percorso diff engine → dispatcher.
- Qualunque stringa letta da un essere umano è una chiave di catalogo, scritta prima in
  inglese.
- Segreti solo da variabili d'ambiente: mai un file di configurazione, mai un database,
  mai una riga di log.
- Le nuove superfici della dashboard si prototipano in `design/` prima di essere
  implementate.
- Per la maggior parte delle superfici esiste già un componente shadcn — usare
  quello, e `cn()` per le classi condizionali, invece di scrivere una nuova classe
  di componente.
- I colori arrivano a un grafico solo tramite `chartConfig`, mai come letterale e
  mai come nome di token costruito a runtime.
- Commit: `<emoji> <TITOLO> - <descrizione>`, in inglese, gitmoji.

### 9.6 Rilasci

Due workflow, e la versione vive in un posto solo.

`.github/workflows/ci.yml` gira su ogni pull request e su ogni push su `dev` o
`main`: Node da `.nvmrc`, `npm ci`, poi gli stessi quattro comandi che si
eseguono in locale — `typecheck`, `test`, `test:integration`, `build`.

Una release è un tag. `package.json` resta `private` (niente viene pubblicato su
npm) ma il suo `version` è l'unica fonte di verità:

```bash
npm version minor          # preversion esegue prima typecheck e le due suite di test,
                           # poi crea il commit e il tag vX.Y.Z
git push --follow-tags
```

Il push del tag avvia `.github/workflows/release.yml`, che ripete i controlli (un
push di tag non fa scattare la CI), si rifiuta di procedere se tag e
`package.json` non concordano, costruisce entrambi i target per `linux/amd64` e
`linux/arm64`, pubblica i quattro tag GHCR con SBOM e provenance, firma i due
digest con `cosign` keyless e crea la release su GitHub.

Le note di rilascio si generano dal log con `tools/release-notes.mjs`, che sfrutta
la convenzione dei commit: `<emoji> <TITOLO> - <descrizione>` è parsabile, quindi
il changelog è raggruppato per superficie (`POLLER`, `UI`, `DOCKER`, …) invece di
essere un elenco di commit. Si può vedere in anteprima per qualunque intervallo
prima di taggare:

```bash
npm run release-notes -- v0.1.0 HEAD
```
