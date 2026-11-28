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
│   │   ├── notificationDispatcher.ts  l'unico chiamante di Notifier.send: chi sente un cambiamento, e quando
│   │   ├── dispatchSender.ts          l'invio vero e proprio: retry, modifica in place, catena di fallback del destinatario
│   │   ├── dispatchEscalation.ts · dispatchChannelHealth.ts  escalation (§3.2) e avvisi sui canali che falliscono (§3.4)
│   │   ├── scheduler.ts               il loop; rilegge la configurazione a ogni ciclo
│   │   ├── clock.ts                   l'unico modo in cui il motore legge l'ora e aspetta (13.2)
│   │   ├── http.ts                    l'unica lettura HTTP: rivalidazione ETag/Last-Modified, decodifica del charset
│   │   ├── routing.ts · mute.ts · maintenance.ts   chi viene avvisato, quando, e cosa è silenziato (§3.27–3.28)
│   │   ├── delivery.ts · onCall.ts    la politica di consegna e la rotazione di reperibilità
│   │   ├── authority.ts · suspicion.ts · freshness.ts   quale lettura fa fede, e quanto fidarsene
│   │   ├── outpost.ts · heartbeat.ts · tracing.ts       consenso degli outpost, dead-man's switch, trace
│   │   ├── chatops/                   i comandi del bot, analizzati ed eseguiti indipendentemente dall'edizione
│   │   ├── logger.ts
│   │   └── i18n/                      stringhe delle notifiche, indipendenti dall'edizione
│   │       ├── index.ts               lookup + fallback su en + formattazione UTC
│   │       ├── en.json                lingua di partenza
│   │       └── de.json  es.json  fr.json  it.json  pt.json
│   ├── adapters/                      (condiviso)
│   │   ├── catalog.ts                 catalogo di provider noti incluso, letto da catalog.json
│   │   ├── catalog.json               il catalogo generato (roadmap 2.1) — scritto da tools/build-catalog.mjs
│   │   ├── catalogFeed.ts             verifica della firma e proposte di spostamento per i cataloghi scaricati (2.2)
│   │   ├── discover.ts                i file di un progetto → provider del catalogo (2.3)
│   │   ├── statuspage.adapter.ts      adapter generico Atlassian Statuspage
│   │   ├── rss.adapter.ts             adapter generico per feed RSS / Atom
│   │   ├── slack.adapter.ts           l'API di stato di Slack
│   │   ├── aws.adapter.ts             il feed degli eventi aperti di AWS Health, per regione
│   │   ├── gcp.adapter.ts             incidents.json di Google Cloud: stato e cronologia in uno
│   │   ├── azure.adapter.ts           il feed di stato di Azure, col suo vocabolario di chiusura
│   │   ├── betterstack · instatus · cachet · cstate · datadog · openstatus · statusio · upptime · uptimekuma · uptimecom · sorry · githubactions   altri prodotti di status page ospitati, un `.adapter.ts` ciascuno
│   │   ├── http · tcp · dns · icmp · imap · json · html · docker · registry · sequence · watchdog   sonde per ciò che non pubblica una status page, un `.adapter.ts` ciascuno
│   │   ├── detect.ts                  quale adapter legge un dato URL (`POST /config/services/detect`)
│   │   ├── plugins.ts                 plugin di adapter caricati da una directory (§3.14)
│   │   ├── import/                    export di Uptime Kuma, Gatus, Statping e StatusGator → provider candidati (2.4)
│   │   └── index.ts                   registro per id di adapter
│   ├── notifiers/                     (condiviso)
│   │   ├── formatting.ts              emoji, colori, etichette di severità, composizione del messaggio
│   │   ├── settings.ts                validazione condivisa per i canali configurati con un solo URL
│   │   ├── telegram.notifier.ts
│   │   ├── webhook.notifier.ts
│   │   ├── …                          ntfy, Gotify, Pushover, Matrix, Teams, PagerDuty, Opsgenie, email, Twilio, MQTT, syslog e gli altri — un `<canale>.notifier.ts` ciascuno, più di trenta in tutto
│   │   └── index.ts                   registro per id di canale
│   ├── outpost/                       (solo outpost, roadmap 1.7 — viaggia nell'immagine Light)
│   │   ├── index.ts                   entrypoint, non parte senza OUTPOST_TOKEN
│   │   ├── server.ts                  POST /probe esegue una sonda, GET /health
│   │   └── healthcheck.ts             risponde la sua route di health
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
│   ├── ui/                            (solo edizione UI)
│       ├── server.ts                  entrypoint
│       ├── runtime.ts                 wiring, condiviso coi test delle API
│       ├── app.ts                     app Express: route, dashboard statica, errori JSON
│       ├── routePaths.ts              la tabella delle route della dashboard, condivisa col router client
│       ├── healthcheck.ts             interroga /health
│       ├── sqliteStateStore.ts        StateStore + cronologia, una transazione per salvataggio
│       ├── sqliteStateRows.ts         gli schemi di riga e gli helper SQL con cui lo store rilegge
│       ├── historyStore.interface.ts  il contratto della cronologia (la UI ne è l'unico consumatore)
│       ├── history.ts                 aggregazione di uptime e incidenti
│       ├── backfill.ts                ricostruisce 90 giorni di storico dagli incidenti di un provider al primo avvio
│       ├── dbConfigSource.ts          configurazione da SQLite; risolve i segreti per nome di variabile
│       ├── dbSettings.ts · dbServices.ts · dbRouting.ts · dbChannels.ts   le righe che legge, una famiglia di tabelle ciascuno
│       ├── secretsFile.ts             credenziali salvate dalla dashboard: file 0600 accanto al database, applicate all'ambiente
│       ├── metrics.ts                  la superficie di scrape Prometheus: gauge dallo store, counter in memoria
│       ├── configFile.ts             export / import di config.yml (§4.3)
│       ├── configAudit.ts · configSnapshots.ts   la cronologia della configurazione e gli snapshot con nome (roadmap 5.7, 5.8)
│       ├── dashboardStore.ts · dashboardLayout.ts   le dashboard Overview con nome e i layout dei loro widget
│       ├── openapi.ts · openapi/      il documento OpenAPI servito su /openapi.json (§6.1), un modulo per area
│       ├── db/                        open.ts, migrate.ts, seed.ts
│       ├── routes/                    un `<area>.routes.ts` ciascuno: status, events, history, incidents, export, notifications, config.* (services, channels, import/export, history, backup, storage, push), dashboards, maintenances, map, metrics, badge, render, public, openapi …
│       └── web/                       la dashboard: react, vite, shadcn/ui
│           ├── index.html             script del tema pre-paint, font, #root
│           ├── main.tsx               albero dei provider: i18n, query, tema, router
│           ├── App.tsx                shell della console: rail, header, contenitore delle viste
│           ├── routes.tsx             route con hash
│           ├── components/ui/         primitive shadcn
│           ├── components/            rail, header, indicatore di polling, dialog, card; charts/, settings/, service-dialog/, dashboards/
│           ├── views/                 overview, providers, dettaglio provider, components, incidents,
│           │                          dettaglio incidente, history, log invii, settings, wallboard
│           ├── widgets/               il registro dei widget dell'Overview, drag della griglia e bozza del layout; catalog/ ha un file per widget
│           ├── __catalog/             il catalogo dei componenti (13.9): storie, ognuna nel suo frame isolato, solo nel dev server
│           ├── hooks/                 queries, theme, live, shortcuts, busy, pull-to-refresh …
│           ├── lib/                   api, types, chartConfig, format, i18n, shortcuts …
│           ├── css/base.css            punto di ingresso Tailwind: importa tailwindcss, tokens, motion
│           ├── css/tokens.css         l'unico file con un colore letterale
│           ├── css/motion.css         keyframes, animazioni d'ingresso, transizioni
│           ├── public/                favicon, manifest PWA, service worker, icone
│           └── locales/               en.json (sorgente) + de, es, fr, it, pt
│   └── cli/                            (solo client da terminale, roadmap 17.7 — `watch` legge l'API dell'edizione UI, `discover` e `import` leggono file locali con src/adapters; non importa mai src/ui)
│       ├── index.ts                    entrypoint, smista verso l'unico sottocomando qui sotto
│       ├── discover/run.ts             `isitdown discover`: i file di un progetto → provider del catalogo (2.3)
│       ├── import/run.ts               `isitdown import`: l'export di un altro monitor → una flotta (2.4)
│       └── watch/
│           ├── run.ts                  l'unica parte che tocca un terminale, un orologio e una rete veri
│           ├── args.ts                 --url / --token / --interval
│           ├── client.ts               client di sola GET per /status e /events
│           ├── sse.ts                  lettore di frame server-sent-events scritto a mano
│           ├── schema.ts               validazione zod delle due risposte che legge
│           ├── watcher.ts              il ciclo lettura → stream → fallback di polling
│           ├── state.ts                riduttori puri: piega una lettura di /status nel modello della vista
│           └── render.ts               il renderer ANSI puro del pannello
├── tools/
│   ├── copy-assets.mjs                copia in dist i cataloghi i18n e delle lingue della dashboard (il
│   │                                   bundle della dashboard è già output di Vite, non di questo script)
│   ├── readme-parity.mjs              ogni pagina inglese contro le sue traduzioni (npm run check:readme)
│   ├── complexity-inventory.mjs       quanto costa ogni sottosistema, come tabella Markdown (9.8)
│   ├── complexity-budget.mjs          tetti sui conteggi dell'inventario, avvisati in CI (npm run check:complexity, 9.8)
│   ├── i18n-orphans.mjs               le chiavi dei cataloghi contro il codice che le chiede (npm run check:i18n)
│   ├── fake-provider.mjs              una pagina di stato locale da rompere a mano, più un receiver webhook (npm run fake-provider)
│   ├── scaffold.mjs                   un nuovo adapter o canale di notifica, impostato e registrato (npm run new:adapter / new:notifier)
│   ├── bundle-budget.mjs              la dashboard compilata contro il suo budget gzip, e il catalogo tenuto fuori (npm run check:bundle)
│   ├── oldest-db.mjs                  test/fixtures/db/oldest-supported.db, dalle migrazioni della release più vecchia supportata (10.3)
│   ├── visual-regression.mjs          ogni vista, entrambi i temi, ogni lingua contro test/visual/baseline (npm run test:visual); helper in tools/visual/
│   ├── envelope.mjs                   memoria, CPU, avvio e crescita del database a 10 / 100 / 500 provider (npm run measure:envelope, docker.it.md 4.9)
│   ├── canary.mjs · loadtest.mjs · mutation.mjs · record-fixture.mjs · release-notes.mjs · build-sea.mjs · pwa-icons.mjs   la sonda canary, test di carico e di mutazione, registrazione dei fixture, note di rilascio, la build a file singolo, icone PWA
│   ├── webhook-schema.mjs             schema/webhook-event.v1.json dalla definizione zod in src/notifiers/webhookEvent.ts (7.11)
│   ├── config-schema.mjs              schema/config.schema.json dallo schema zod del config in src/light/config/schema.ts — da rilanciare dopo averlo cambiato (11.5)
│   ├── build-catalog.mjs              rigenera il catalogo da tools/catalog/seed.json e dalle liste pubbliche (2.1)
│   └── sign-catalog.mjs               firma catalog/catalog.json con $CATALOG_SIGNING_KEY (2.2)
├── schema/webhook-event.v1.json       lo schema JSON pubblicato del webhook generico, confrontato con quello generato (7.11)
├── schema/config.schema.json          lo schema JSON pubblicato del config.yml della Light, confrontato con quello generato (11.5)
├── examples/                          un workflow n8n e un flow Node-RED che ricevono l'evento del webhook
├── catalog/                           il catalogo pubblicato e firmato, e il report dell'ultima generazione
├── test/
│   ├── core/                          diff engine, poller, scheduler, dispatcher, i18n, schemi
│   │   └── stateStore.contract.ts     una suite che ogni implementazione di StateStore deve passare
│   ├── adapters/
│   ├── notifiers/                     test per canale, più contract.test.ts e golden/ (3.8)
│   ├── light/
│   ├── outpost/                       il server POST /probe senza stato
│   ├── tools/                         il generatore del catalogo
│   ├── visual/                        baseline/ — i frame della dashboard concordati
│   ├── ui/                            contratto dello store, aggregazione, ogni route API, guardie tema e lingue
│   ├── cli/                           args, riduttori e renderer di watch, e il ciclo contro un server finto
│   ├── fixtures/statuspage/           payload registrati dalle pagine vere, mai scaricati in un test
│   ├── fixtures/db/                   oldest-supported.db — il database più vecchio che una build deve aprire (10.3)
│   ├── helpers/
│   └── integration/                   *.itest.ts — provider finto e ricevitore webhook end to end
├── docs/grafana/isitdown.json         la dashboard Grafana committata per /metrics
├── design/                            prototipi Claude Design (in .gitignore: su disco, non in un clone)
├── Dockerfile                         builder → light → dev → ui (dev è FROM builder; ui è FROM light)
├── docker-compose.yml                 entrambe le edizioni come profili
├── docker-compose.dev.yml             override di sviluppo: edizione UI live da src/, Vite ricompila il bundle in watch
├── config.example.yml                 template versionato; config.yml è in .gitignore
├── .env.example                       nomi delle variabili dei segreti, mai valori
├── .nvmrc  .npmrc                     fissano Node 26 e fanno fallire in modo esplicito una versione più vecchia
├── .devcontainer/                     ambiente pronto per Codespaces (roadmap 13.10)
├── tsconfig.json                      TypeScript del server
├── tsconfig.light.json                la build Light: esclude src/ui
├── tsconfig.cli.json                   la build del client da terminale: solo src/core/i18n e src/cli
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
| Runtime | Node.js 26 | Obbligatorio: servono sia il driver SQLite integrato sia lo strip nativo dei tipi TypeScript. |
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
| Container | un `Dockerfile` multi-stage | `--target light` / `--target ui`, `node:26-alpine`. |

Dipendenze a runtime, in modo esaustivo: `zod` e `yaml` (entrambe le edizioni), `express`
e `web-push` (UI, dove viene costruito il canale Web Push). Tutto ciò che la dashboard usa — React, Vite, Tailwind, le
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

**Oppure si salta il setup: un Codespace.**
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/DevManfre/isitdown?ref=dev)
`.devcontainer/` (roadmap 13.10) costruisce lo stesso ambiente su Codespaces o
su qualsiasi host di devcontainer (*Reopen in Container* di VS Code,
`devcontainer up`): Ubuntu 24.04 come la CI, Node 26, il Chromium che
`test:visual` fissa già installato, `npm ci` eseguito e gli hook git
installati. Il provider finto qui sotto gira già sulla **4010**, riavviato a
ogni avvio del container (log in `/tmp/fake-provider.log`), e le porte 3000,
5173 e 4010 sono inoltrate. `npm test`, `npm run dev:ui` e
`npm run build:ui && npm run test:visual` funzionano senza altri passi. Il badge
apre `dev`, il branch che porta gli hook; su `main` il container funziona
allo stesso modo, senza gli hook.

**Si parte dal provider finto.** Una dashboard puntata sui provider reali
mostra quello che GitHub e Cloudflare stanno facendo oggi, cioè di solito
niente. `npm run fake-provider` (roadmap 13.11, `tools/fake-provider.mjs`)
avvia una pagina di stato locale su una porta fissa, la **4010**, e permette di
romperla a mano:

```bash
npm run fake-provider   # pagina di controllo su http://127.0.0.1:4010/ (--port per spostarla)
```

Risponde in tre dialetti insieme: Statuspage con URL base
`http://127.0.0.1:4010/statuspage`, Instatus su `…/instatus` e RSS su
`…/rss/feed.xml`. Fa anche da receiver webhook su `…/hook`. Si aggiunge il
finto come provider nella dashboard, si punta un canale webhook al receiver,
poi si usa la pagina di controllo: livello di ogni componente, aprire un
incidente e portarlo di stato in stato fino a risolto, avviare o chiudere una
manutenzione, far rispondere i feed con un 500 o lentamente. Il poll
successivo (*Aggiorna ora* ne avvia uno) mostra il cambiamento nella dashboard, e la notifica
che ne parte compare sotto *Webhook receiver* nella stessa pagina. Lo stato sta
in memoria: riavviare il finto riparte da tre componenti operativi. Con
`dev:docker` va avviato con `npm run fake-provider -- --host 0.0.0.0` (il
container non raggiunge il loopback dell'host) e si usa
`http://host.docker.internal:4010` al posto di `127.0.0.1`. Entrambe le modalità di
sviluppo lasciano già passare quell'indirizzo dalla policy di uscita della UI
([3.38](configuration.it.md#338-la-policy-di-uscita--cosa-può-raggiungere-una-sonda)):
`dev:ui` imposta `EGRESS_ALLOW=127.0.0.1,::1`, `dev:docker` imposta
`EGRESS_ALLOW=host.docker.internal`. La suite
d'integrazione (`test/integration/fakeProvider.itest.ts`) importa lo stesso
server e lo fa leggere agli adapter veri, quindi un finto che gli adapter non
sanno più leggere fa fallire la CI per primo.

**Aggiungere un adapter o un canale** (roadmap 13.8) parte da un generatore, la
stessa ricetta che seguono le skill `add-status-adapter` e `add-notifier-channel`:

```bash
npm run new:adapter -- acme-status    # src/adapters/acme-status.adapter.ts e il resto
npm run new:notifier -- acme-push     # src/notifiers/acme-push.notifier.ts e il resto
```

Un adapter riceve il suo file, un test (il contratto degli adapter più un test
di mappatura), un fixture segnaposto in `test/fixtures/<id>/`, la voce nel
registro e una riga nella tabella degli adapter di
[3.5](configuration.it.md#35-provider-monitorati), in entrambe le lingue. Un
canale riceve il suo file, un test, la voce nel registro, `channel.name.<id>` in
tutti e sei i cataloghi della dashboard (in inglese ovunque finché qualcuno non
lo traduce) e una riga in [3.6](configuration.it.md#36-canali-di-notifica), in
entrambe le lingue. Ciò che scrive compila; ciò che non può sapere — l'endpoint,
le impostazioni — lancia "not implemented", così i test generati falliscono
finché non viene scritto, e il resto (fixture registrati, caso di contratto,
schema della Light, seed della UI, variabili d'ambiente) viene stampato come
lista di controllo. Un id che esiste già viene rifiutato prima di scrivere
qualunque cosa.

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
                         # (coverage:server e coverage:web ne eseguono una ciascuno, come fa la CI)
npm run test:integration # suite end-to-end:  test/**/*.itest.ts
npm run test:visual      # baseline visive + un passaggio axe-core: ogni vista, entrambi i temi, entrambe le lingue
npm run test:visual:stories # lo stesso per componente: ogni storia del catalogo (serve build:catalog)
npm run test:mutation    # mutation testing sul diff engine
npm run test:load        # 200 provider sintetici, una settimana di storico, ogni lettura cronometrata
npm run canary           # ogni pagina del catalogo, dal vivo, contro i fixture del suo adapter (1.9)
npm run check:bundle     # la dashboard compilata contro il suo budget di dimensione gzip
npm run check:readme     # questo file contro ogni README.<lang>.md
npm run check:i18n       # chiavi di catalogo che nessun codice usa (avviso) e chiavi usate che mancano (errore)
npm run check:quarantine # test/quarantine.json: fallisce su una voce scaduta o malformata (13.6)
npm run check:cve-exceptions # .trivyignore.yaml: fallisce su una CVE accettata senza motivo, o scaduta (9.6)
npm run typecheck        # tsconfig del server + tsconfig della dashboard (tsconfig.web.json)
npm run lint             # Biome, solo controllo: regole correctness + suspicious, nessun formatter
npm run build:light      # tsc + copia asset, escludendo src/ui
npm run build:ui         # tsc + vite build + copia asset
npm run build:cli        # tsc + copia asset, solo src/core/i18n e src/cli (10.1)
npm run build:catalog    # solo il catalogo dei componenti, in dist/catalog (13.9)
```

Il budget del bundle (roadmap 5.16) pesa ciò che `build:ui` ha prodotto, in
gzip, perché è quello che il browser scarica: `731,000` byte di JavaScript e `23,500` di
CSS (`BUDGET` in `tools/bundle-budget.mjs`), entrambi poco sopra la build di oggi. È
un tetto, non un obiettivo — quando fallisce, prima si trova cosa è cresciuto; è stato
alzato solo in un commit che nomina le righe di roadmap che l'hanno fatto crescere.
Lo stesso controllo fallisce se un asset compilato contiene il marcatore del
catalogo dei componenti (`CATALOG_MARKER` in `src/ui/web/__catalog/marker.ts`):
il catalogo è una pagina di sviluppo e non viene mai distribuito.

Il **catalogo dei componenti** (roadmap 13.9) mostra ogni componente catalogato
in ogni stato — popolato, vuoto, caricamento, errore, ogni severità — chiaro e
scuro affiancati, in una qualunque delle sei lingue. Con `npm run dev:ui` avviato
si trova su `http://localhost:5173/__catalog/`; `?story=<id>&theme=dark&locale=it`
apre una storia da sola. Le storie sono oggetti semplici in
`src/ui/web/__catalog/stories.tsx` — `{ id, component, props, state }`, più
`fixtures` (cosa risponde l'API finta, con lo stesso instradamento dell'harness
di Vitest, da `src/ui/web/test/fakeApi.ts`) e `storage` (cosa ricorda il
browser). Ogni storia gira nel suo frame, con uno storage in memoria tutto suo e
un `fetch` che non arriva mai al server: lo stato di caricamento di un componente
è una richiesta davvero trattenuta, quello di errore una richiesta davvero
fallita. Niente Storybook: il catalogo è un secondo entry di Vite,
`__catalog/index.html`, che la build di produzione non nomina mai.
`stories.test.tsx` renderizza ogni storia e controlla che sia nello stato che
dichiara; aggiungere un componente vuol dire aggiungere lì le sue storie.

Il **controllo delle chiavi orfane** (roadmap 13.5, `tools/i18n-orphans.mjs`)
confronta entrambi i cataloghi inglesi, quello della dashboard
`src/ui/web/locales/en.json` e quello del server `src/core/i18n/en.json`, con
ogni file sorgente sotto `src/`. Una chiave conta come usata quando un
letterale tra virgolette la nomina (così vale anche una costante `labelKey`
passata più tardi a `t()`), quando un template literal come
`` `theme.${mode}` `` potrebbe costruirla, o quando è una forma plurale di una
base usata. Una chiave costruita in qualsiasi altro modo va in
`tools/i18n-orphans.allow.json` (`{ "<scope>": { "keys": [], "prefixes": [] } }`,
scope `dashboard` o `server`). Un'orfana è un avviso, e la CI la annota;
`npm run check:i18n -- --fix` la cancella da ogni catalogo del suo scope in un
colpo solo, riga per riga, così il diff mostra solo le chiavi cancellate. Una
chiamata `t("…")` che nomina una chiave assente dal catalogo fa fallire il
passo, perché l'utente vedrebbe la chiave grezza. I file di test non vengono
letti: una chiave che solo il suo test chiede non ha comunque niente che la
mostri.

**I test instabili vanno in quarantena, mai ripetuti** (roadmap 13.6). Una voce
in `test/quarantine.json` nomina un test — `suite` (`server` o `dashboard`),
`name` (i nomi dei describe e il suo, uniti da spazi, come li stampano entrambi i
runner), `owner`, `reason`, `issue` (un link) e `expires` (una data). Ogni
script `npm test` e `coverage:*` passa per `tools/quarantine.mjs`: finché una
voce è attiva, il suo test viene saltato nel run bloccante ed eseguito in un
secondo run non bloccante, il cui esito va nel riepilogo del job — così continua
a girare, e una correzione si vede come "passed — maybe stable again". Dal
giorno dopo `expires` il test torna bloccante e `npm run check:quarantine` (il
job `static` della CI) fallisce finché la voce non viene tolta o rinnovata con
un motivo nel diff. Con il file vuoto gli script girano esattamente come prima.
Nessun test fallito viene ripetuto da nessuna parte: un retry nasconde un test
instabile, la quarantena lo nomina.

Il **budget di tempo della CI** (roadmap 13.6) è l'ultimo passo di `verify`:
`tools/ci-durations.mjs` legge dall'API di GitHub la durata di ogni job del run e
scrive una tabella nel riepilogo, con un'annotazione di avviso su ogni job oltre
il suo tetto. I tetti (`CEILINGS` in quel file) sono circa 1,5× il più lento di
sei run verdi; un test controlla che ogni job definito in `ci.yml` ne abbia uno.
Oltre il tetto è un avviso, mai un run rosso — il tetto si alza nel commit che
rende il job più lento, spiegando perché.

La soglia di copertura (roadmap 7.2) è un minimo garantito, non un obiettivo da
rincorrere. Sono due, perché le due suite coprono metà diverse: il server e il
core devono restare al 95% delle righe, all'88% dei rami e al 93% delle
funzioni, e la dashboard a 85/75/80 — ciascuna qualche punto sotto il valore
attuale, così il movimento ordinario passa e un sottosistema nuovo che arriva
senza test propri trascina il totale sotto la soglia e fa fallire la CI. Alza una
soglia quando la suite è davvero salita; non abbassarne mai una per far tornare
verde una run rossa.

Il **test property-based del diff engine** (roadmap 13.1,
`test/core/diffEngine.property.test.ts`) affianca la sua tabella di
transizioni: 500 sequenze casuali seedate di letture — incidenti che si aprono
e si chiudono, componenti, finestre di manutenzione, mute, pagine illeggibili —
attraverso lo stesso cancello `confirmedChanges` che chiama il poller,
verificando a ogni passo che niente venga notificato due volte, niente esca da
una finestra o da un mute, una pagina invariata non dica nulla, `unknown` non
sia mai una transizione e una pagina tornata operativa chiuda ogni incidente.
Un fallimento stampa il seme e una sequenza ridotta; `PBT_SEED=<n>` la
riproduce e `PBT_RUNS=<n>` cambia quante sequenze prova un run. Un bug trovato
così diventa anche una riga della tabella.

**Il tempo nei test** (roadmap 13.2) passa dal `Clock` in `src/core/clock.ts`:
scheduler, poller e dispatcher ne ricevono uno come `clock`, e un test passa
`manualClock()` da `test/helpers/manualClock.ts` — `advance(ms)` e
`setNow(date)` fanno scattare in ordine i timer scaduti, `sleep` sposta il
clock e registra l'attesa in `delays`. Una guardia in
`test/core/boundaries.test.ts` fa fallire ogni test del core che usi un
`setTimeout` reale, `t.mock.timers` o un `Date` sostituito, e ogni `Date.now()`
o timer diretto che torni in quei tre moduli.

**Il database più vecchio supportato** (roadmap 10.3) è
`test/fixtures/db/oldest-supported.db`: lo schema di v1.0.0 (7), con quattro
provider, novanta giorni di campioni, incidenti aperti e risolti, componenti, un
canale attivo e un log degli invii. `test/integration/oldestDatabase.itest.ts`
lo copia, lo apre con la build corrente e verifica che `/status`, `/history`,
`/incidents`, `/config` e `/notifications` restituiscano ancora i suoi dati, e
che le tabelle aggiunte dopo (rollup, annotazioni) funzionino sopra di esso; il
harness visivo disegna Panoramica e Cronologia sopra di esso come
`overview-oldest` e `history-oldest`. Ogni altro test parte da un database
vuoto, quindi è questo che fallisce quando una migrazione rompe
un'installazione vecchia di un anno. Il file non si scrive a mano:
`node tools/oldest-db.mjs` esegue `migrate.ts` e `seed.ts` di quella release,
letti da git al suo tag, poi riempie le righe. Quando si alza la release minima
supportata, si cambia `OLDEST_TAG` nello script, si rigenera il file e si
accettano di nuovo i due frame, tutto in **un commit a sé**, senza nient'altro
dentro.

Il **passaggio sull'accessibilità** (roadmap 4.20) viaggia sull'harness visivo: dopo
che ogni vista si è assestata, `tools/visual-regression.mjs` inietta axe-core e
controlla WCAG 2.0 e 2.1 A e AA più 2.2 AA (le regole di best practice sono escluse
di proposito). A differenza di uno screenshot, una violazione non viene mai messa a
baseline — l'esecuzione fallisce e stampa la regola, le schermate in cui è stata
trovata e un selettore ciascuna (`--verbose` aggiunge ciò che axe ha misurato e il
markup del nodo), anche con `--update`, così accettare un'immagine non si confonde con
accettare una barriera. Anche le tre varianti di tema vengono verificate, senza
baseline. Una regola che va derogata entra in `ACCEPTED` nell'harness con la sua
ragione accanto. axe-core è una dipendenza di sviluppo, iniettata nella pagina e non
distribuita con essa.

Il **load test** (roadmap 7.4) risponde a una domanda che le altre suite non
pongono: non "è veloce" ma "dove smette di esserlo". `tools/loadtest.mjs`
sintetizza un parco provider che nessuno ha — 200 provider e una settimana di campioni
alla cadenza di default, circa 670 000 righe e ~100MB di SQLite — in una
directory temporanea, poi cronometra ogni lettura che fa la dashboard e
ricancella il database. Nulla parla con un provider, e i dati sono
deterministici, così due esecuzioni sono confrontabili.

```bash
npm run test:load                                    # il parco provider di default
node tools/loadtest.mjs --providers=400 --days=30    # un soak, per trovare il ginocchio della curva
```

Cosa ha trovato, su un portatile di sviluppo:

| Parco provider | `/status` | `/history?days=90` | `/incidents` | `/metrics` |
|---|---|---|---|---|
| 200 provider × 7 giorni (670k campioni) | 0,3s | 0,8s, 1,4MB | 23ms | 14ms |
| 400 provider × 30 giorni (5,8M campioni) | **4,1s** | **7,8s**, 2,8MB | 61ms | 19ms |

La forma è chiara. Tutto ciò che legge una riga e la restituisce resta nei
millisecondi per quanto cresca il parco provider — il pager degli incidenti, le
metriche, il riepilogo del badge, Home Assistant — e i due endpoint che
*aggregano sui campioni* sono quelli che cedono: `/status`, che deriva un uptime
a 90 giorni per provider, e `/history`, il cui payload cresce anche con il
parco provider. Il ginocchio della curva sta sotto i 400 provider con un mese di retention; a 200 e
una settimana è tutto comodo.

È la risposta a "dove servirebbe lavoro": non il poller, e non le scritture di
SQLite, ma un rollup — bucket giornalieri salvati invece che aggregati a ogni
richiesta — dietro a quelle due letture. Nulla in roadmap ne ha ancora bisogno,
e questo script è il modo in cui il giorno in cui servirà si vedrà invece di
arrivare come una segnalazione.

Non è in CI, deliberatamente: scrive centinaia di migliaia di righe e richiede
circa un minuto. I budget p95 nello script sono generosi per lo stesso motivo
per cui la soglia di copertura è un minimo garantito — intercettano una regressione di
un ordine di grandezza (un indice caduto, una query che ha iniziato a fare
scansioni), non qualche punto percentuale di deriva.

Il suo fratello `tools/envelope.mjs` (roadmap 8.8) dimensiona la macchina
invece delle query: entrambe le edizioni, compilate, a interrogare 10, 100 e
500 provider su un finto provider locale, con memoria residente, CPU per ciclo,
tempo di avvio e crescita del database letti da lì. `npm run measure:envelope`
stampa la tabella che
[4.9](docker.it.md#49-inviluppo-di-risorse--quanto-costa-un-parco-provider)
riporta, con data, versione e macchina su cui è stata misurata; si rilancia e
si incolla il blocco quando un rilascio sposta uno di quei numeri. Anche questo
a mano, non in CI: serve una `npm run build:ui` fresca e richiede una decina di
minuti.

Il mutation testing (roadmap 7.3) pone la domanda che la copertura non può
porre: una riga eseguita non è una riga a cui un test avrebbe obiettato.
`tools/mutation.mjs` cambia un operatore in `src/core/diffEngine.ts` — un
confronto invertito, un confine spostato di uno, `&&` al posto di `||` — esegue
la suite propria del diff engine e riporta ogni mutante che la suite continua a far
passare. Quello è un comportamento del diff engine che nulla sta tenendo fermo, e il
diff engine è l'unica autorità su se qualcuno viene avvisato di qualcosa: è per
questo che qui vale la pena farlo e altrove no. Non prende dipendenze e costa
circa un minuto.

A un sopravvissuto si risponde con un test, non con una lista di mutazioni più
corta. L'eccezione è una mutazione che non si può proprio osservare — scambiare
il connettivo in `if (until === null || until === undefined) return false`
quando la guardia sui NaN qui sotto risponde già `false` per entrambi. Quelle si
dichiarano nel sorgente stesso, accanto al motivo:

```ts
// mutation-equivalent: || — `Date.parse` answers NaN for both, and the NaN
// guard below already returns false, so the two connectives are one function.
```

Sopprime solo l'operatore nominato e solo sulla riga di codice successiva, e la
run stampa comunque quante ne sono state scusate, perché un punteggio che
nasconde ciò che ha escluso non è un punteggio. Gira su richiesta e non in CI: i
mutanti vengono scritti sul file sorgente vero e poi ripristinati, il che va
bene in un albero di lavoro ed è sbagliato prendere come abitudine a ogni push.

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
- **Contratto dei notifier** — un'unica suite che ogni canale deve superare
  (roadmap 3.8): ogni tipo di cambiamento consegnato, un rifiuto tipizzato come
  `ChannelError` senza credenziali dentro, ogni campo limitato tagliato per
  entrarci, una chiave di deduplicazione stabile, le versioni in testo semplice e
  formattate che nominano entrambe l'incidente, e i byte esatti in rete
  confrontati con `test/notifiers/golden/` — `UPDATE_GOLDEN=1 node --test
  test/notifiers/contract.test.ts` li riscrive, da rivedere come qualunque diff.
  Un canale aggiunto al registro senza un caso o un'esenzione dichiarata la fa
  fallire.
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
  le lingue su un parco provider fisso e con l'orologio congelato, poi confrontata con
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
  `package.json`. L'orologio è congelato su un istante *e* su un fuso, da
  entrambe le parti — l'harness rende in UTC e dice al browser di fare lo stesso
  — perché una colonna oraria, il default di un campo data e un bucket
  giornaliero sono letture da orologio da parete: fissato solo l'istante, una
  baseline concordata a Roma non può mai essere verde su un runner in UTC.
  Oltre alla flotta piena, alcune viste sono disegnate con le fixture `empty`
  (nulla configurato) e `quiet` (provider ma nessun incidente, storia o messaggio),
  e la Panoramica ancora una volta contro un server che serve il bundle e chiude
  ogni richiesta API — gli stati che la roadmap 4.21 fissa (`overview-empty`,
  `history-quiet`, `overview-offline`, …).
  `node tools/visual-regression.mjs --update` accetta un cambio
  voluto, `--only=<vista>` serve mentre si itera su una sola. `--stories`
  renderizza invece le storie del catalogo dei componenti
  (`npm run test:visual:stories`, dopo `npm run build:catalog`): ogni frame è il
  riquadro del componente, ritagliato dalla pagina, con le baseline in
  `test/visual/baseline/stories/` — poche centinaia di pixel di lato, che si
  muovono solo quando si muove quel componente. `--only=` accetta un componente
  (`--only=provider-tile`) o l'id di una storia.

  Quel rumore dell'1,5% lungo i bordi del testo presuppone che la macchina su
  cui gira Chromium abbia i font di sistema che la build di Chromium di
  Playwright si aspetta — la CI li ha perché installa il browser con `npx
  playwright@1.64.1 install --with-deps` (la release è fissata: cambiarla richiede
  una revisione delle baseline), che tira dentro `fontconfig` e
  `fonts-liberation` come root insieme a Chromium stesso (vedi `deb.deps`
  accanto al binario in cache per l'elenco completo). Un sandbox che non può
  eseguire quell'installer come root e invece spacchetta a mano gli stessi
  file `.deb` ottiene il binario di Chromium ma non quei due: senza di essi
  Chromium non ha alcun percorso di fallback per i font di sistema, un guasto
  diverso dal normale rumore cross-macchina — ogni vista tornava con 20-30×
  il valore di `MAX_MOVED` in celle spostate, non una manciata, anche su testo
  che nessuna modifica aveva toccato. Puntare `FONTCONFIG_FILE` su una
  configurazione minima il cui `<dir>` è i file di `fonts-liberation`
  spacchettati, e `LD_LIBRARY_PATH` sulle `libfontconfig`/`libcairo`/`libpango`
  spacchettate, ha richiuso il divario tornando alla normale fascia di rumore
  su ogni vista senza cambi di testo. Il testo del corpo della dashboard
  continua comunque a rendere come Inter in entrambi i casi — `index.html` lo
  scarica da Google Fonts via rete, che l'harness lascia raggiungibile proprio
  per questo motivo (vedi `tools/visual/chrome.mjs`) — quindi i pacchetti
  mancanti non riguardavano mai il carattere principale, solo il percorso di
  fallback di cui ha ancora bisogno ogni altro pezzo di interfaccia (le icone,
  le parole chiave CSS di famiglia generica).
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
- **Canary notturno** (roadmap 1.9) — l'unico controllo che parla con provider
  veri, e per questo l'unico che non fa mai parte della suite.
  `tools/canary.mjs` legge ogni pagina del catalogo incluso attraverso il suo
  adapter reale e confronta la forma di ogni risposta JSON con il fixture
  committato più simile sotto `test/fixtures/<adapter>/`. Conta solo ciò che
  romperebbe un parser: un campo che il fixture ha e la pagina ha perso, o uno
  che ha cambiato tipo — un campo che il provider ha *aggiunto* non è deriva, e
  sotto una lista vuota stanotte non si giudica niente. Una pagina il cui adapter
  lancia un errore è **rotta**; una pagina che risponde 403 o va in timeout è
  **non ha risposto** ed è elencata a parte, perché un IP di datacenter
  rifiutato è una notizia della rete, non dell'adapter.
  `.github/workflows/canary.yml` lo esegue alle 03:17 UTC, su nessun push e
  nessuna pull request, e tiene aggiornata un'unica issue con etichetta
  `canary` con l'ultimo report; una notte pulita non chiude niente, la chiude la
  correzione. `npm run canary` lo esegue a mano, `--only github,openai` lo
  restringe, `--report file.md` scrive il report invece di stamparlo.
- **Generazione settimanale del catalogo** (roadmap 2.1 e 2.2) —
  `tools/build-catalog.mjs` legge il seed curato in `tools/catalog/seed.json` e
  la sezione "Public Status Pages" di awesome-status-pages, passa ogni candidato
  per `detectAdapter`, lo legge una volta tramite l'adapter indicato dalla
  detection, e scrive ciò che ha risposto in `src/adapters/catalog.json` e
  `catalog/catalog.json` — una voce per pagina, redirect seguiti, ogni URL in
  https — più `catalog/report.md` che nomina tutto ciò che è rimasto fuori e
  perché. Una voce già nel catalogo non viene mai rimossa per una sola lettura
  fallita; resta e viene nominata nel report. `tools/sign-catalog.mjs` poi firma
  la copia pubblicata con Ed25519. `.github/workflows/catalog.yml` esegue
  entrambi il lunedì alle 04:41 UTC, committa la lista rigenerata su `dev` senza
  revisione quando è cambiata, e spinge i tre file pubblicati su `main`, che è
  ciò che leggono le installazioni con gli aggiornamenti del catalogo attivi. La
  chiave privata esiste solo come secret del repository `CATALOG_SIGNING_KEY`;
  senza, il job si ferma prima di pubblicare qualunque cosa. Ruotarla significa
  cambiare `CATALOG_PUBLIC_KEY` in `src/adapters/catalogFeed.ts` nello stesso
  rilascio — il passo di firma rifiuta una chiave che non corrisponde. Entrambi
  i push passano per una deploy key con scrittura salvata come
  `CATALOG_DEPLOY_KEY`, perché la ruleset di `main` richiede il check `verify` e
  lascia scavalcarlo solo agli admin e alle deploy key; un push con
  `GITHUB_TOKEN` lì verrebbe rifiutato. Per
  aggiungere un provider a mano, lo si aggiunge al seed (con `adapter` per
  saltare la detection) e si esegue `node tools/build-catalog.mjs`.

La dashboard è ora TypeScript vero, verificato dal proprio `tsconfig.web.json`
invece che da un passaggio guidato da JSDoc su JavaScript puro; i suoi componenti e
hook sono testati con Vitest e React Testing Library, collocati come `*.test.tsx`
accanto a ciò che coprono.

### 9.5 Convenzioni

- **Togliere prima di aggiungere** (roadmap 16.6). Ogni nuova issue e pull request
  dice cosa semplifica o rimuove, oppure dichiara apertamente che aggiunge
  complessità e perché ne vale la pena — una chiave di configurazione, una
  variabile d'ambiente, un'impostazione, una schermata, una dipendenza. Non vieta
  niente: rende ogni aggiunta una scelta. Il template delle pull request ha la
  sezione, e [9.8](#98-inventario-della-complessità) dà i numeri su cui discutere.
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

Tre workflow, e la versione vive in un posto solo.

`.github/workflows/ci.yml` gira su ogni pull request e su ogni push su `dev` o
`main`, come job affiancati su runner propri — typecheck, lint e parità
del README; `coverage:server` e `test:integration`; Vitest diviso su due runner
(`coverage:web:shard`), poi unito e confrontato con la soglia
(`coverage:web:merge`); e `build`, `check:bundle` e `test:visual` — così un run
dura quanto il suo percorso più lento. Un ultimo job, `verify`, passa solo se
sono passati tutti gli altri: è il check che la ruleset di `main` richiede e
quello che legge la release.

Una release è un tag. `package.json` resta `private` (niente viene pubblicato su
npm) ma il suo `version` è l'unica fonte di verità:

```bash
npm pkg set version=X.Y.Z  # poi la stessa versione in package-lock.json, a mano
git commit -am "🔖 RELEASE - bump the version to X.Y.Z"
```

`npm version` non funziona in questo repo: fallisce dopo aver già scritto la
nuova versione, quindi un secondo tentativo fa un doppio bump. Si aggiornano
`package.json` e `package-lock.json` (`version` e `packages[""].version`) a mano.
La skill `release-flow` ha la sequenza completa, dal bump su `dev` alla pull
request verso `main` fino alla release pubblicata.

Il merge della pull request di rilascio (`release/vX.Y.Z`) su `main` è il
rilascio: `.github/workflows/tag-release.yml` gira a ogni push su `main`, e
quando la versione di `package.json` è diversa da quella che `main` aveva prima
del push (o il push è il merge di `release/v<versione>`) e `v<versione>` non ha
ancora un tag, crea il tag annotato su quel commit e richiama `release.yml` con
quel tag. Ogni altro push su `main` finisce lì senza creare nulla. Il tag viene
pubblicato con il `GITHUB_TOKEN` del workflow stesso — nessun token personale,
nessun segreto in più — e, per una regola di GitHub, un tag pubblicato così non
avvia alcun workflow: per questo `release.yml` è richiamato come workflow
riutilizzabile invece di aspettare il push del tag, ed è per questo che lo
stesso rilascio non parte mai due volte.

Il push a mano di un tag `vX.Y.Z` funziona ancora ed è l'alternativa — per un
commit che il percorso automatico ha saltato, o per ripetere un rilascio dopo
averne cancellato il tag:

```bash
git tag -a vX.Y.Z origin/main -m "🔖 RELEASE - vX.Y.Z"
git push origin vX.Y.Z
```

Un tag pubblicato a mano prima che arrivi il merge fa uscire `tag-release.yml`,
quindi quel rilascio parte una volta sola, dal push del tag; inoltre il job di
rilascio è serializzato per tag, così due run della stessa versione non
pubblicano mai in parallelo.

In entrambi i casi `.github/workflows/release.yml` gira sul tag: prima attende
il check `verify` della CI sul commit taggato (un tag non fa scattare la CI da
solo, quindi legge il run avviato dal push di `main`) e si ferma se è fallito, si
rifiuta di procedere se tag e
`package.json` non concordano, costruisce entrambi i target per `linux/amd64` e
`linux/arm64` — lo stage di build gira una sola volta sulla piattaforma del
runner, perché il suo output è JavaScript puro, così sotto emulazione arm64 resta
solo l'`npm ci` di produzione — pubblica i quattro tag GHCR con SBOM e provenance, firma i due
digest con `cosign` keyless e crea la release su GitHub.

Lo stesso workflow costruisce l'edizione Light in un solo file (roadmap 6.7) con
`npm run build:sea` e la allega alla release con accanto un `.sha256` — vedi
[4.5](docker.md#45-nessuno-dei-due-ledizione-light-in-un-solo-file).

Le note di rilascio si generano dal log con `tools/release-notes.mjs`, che sfrutta
la convenzione dei commit: `<emoji> <TITOLO> - <descrizione>` è parsabile, quindi
il changelog è raggruppato per superficie (`POLLER`, `UI`, `DOCKER`, …) invece di
essere un elenco di commit. Si può vedere in anteprima per qualunque intervallo
prima di taggare:

```bash
npm run release-notes -- v0.1.0 HEAD
```

Lo stesso raggruppamento, una sezione per tag, è `CHANGELOG.md` nella radice
(roadmap 14.1). Si genera, non si modifica a mano: `npm run changelog` lo
riscrive dai tag, e `npm run changelog -- --release X.Y.Z` aggiunge i commit
dall'ultimo tag come rilascio in arrivo, datato oggi — il release flow lo lancia
subito prima del commit di bump, così il changelog viaggia dentro il rilascio
che descrive.

### 9.7 Aggiornamenti delle dipendenze e di Node

Roadmap 13.7. Le dipendenze si muovono a piccoli passi regolari, ognuno dietro
lo stesso cancello di qualsiasi altra modifica, così che nessun aggiornamento
debba mai diventare un progetto.

**Le pull request le apre Renovate** (`renovate.json`, che richiede l'app
GitHub di Renovate installata sul repository). Puntano a `dev`, arrivano il
lunedì mattina (Europe/Rome), e niente si fonde da solo: una PR si fonde a mano
quando il run completo della CI è verde. Quel run comprende typecheck e lint,
test unitari sotto la soglia di copertura, integrazione, budget del bundle e
baseline visive, tutto descritto in [9.6](#96-rilasci). Una release più giovane
di tre giorni non viene proposta (`minimumReleaseAge`), e questo tiene fuori un
pacchetto ritirato da npm il primo giorno. Una correzione di sicurezza salta sia
il calendario sia l'attesa.

| Cosa | Come arriva |
|---|---|
| patch e minor delle devDependency | una PR settimanale per tutte |
| lo stack della dashboard (React, Vite, Vitest, Tailwind, shadcn, Radix e i loro plugin) | un gruppo solo, perché una major in uno rompe gli altri; le sue major in una PR separata dalle minor |
| ogni altra major | una PR per pacchetto |
| patch e minor delle GitHub Actions | una PR settimanale; una major ha la sua |
| l'immagine base Node del `Dockerfile` (digest, minor, patch) | una PR, quando il tag viene ripubblicato |
| le dipendenze transitive del lockfile | un refresh settimanale del lockfile |
| una major di Node | mai dal bot, vedi sotto |

Una PR che fallisce `test:visual` non è rotta per definizione: Tailwind, Radix o
Recharts possono spostare pixel legittimamente. Si guardano i frame, si
accettano in un commit `✅ VISUAL` separato sullo stesso branch
([9.4](#94-test-e-controlli)), e si fonde quando è verde. Una PR che fallisce
qualsiasi altra cosa aspetta una correzione, oppure si chiude con il motivo in
un commento. Renovate poi lascia stare quella versione.

**Renovate scrive il lockfile con npm 11** (`"constraints": { "npm": "^11" }`),
cioè l'npm che arriva con Node 26 e che usa la CI. Lasciato a sé sceglie l'npm
più recente, e npm 12 ha `allow-remote=none` come default; con quel default,
`npm install --package-lock-only` rifiuta il tarball del registry di qualsiasi
pacchetto con `bundleDependencies` (`@tailwindcss/oxide-wasm32-wasi` di
Tailwind 4) con `EALLOWREMOTE`: è un bug di npm,
[npm/cli#9800](https://github.com/npm/cli/issues/9800). La PR allora cambia
`package.json` ma non `package-lock.json`, e `npm ci` fa fallire ogni job. Il
vincolo si toglie quando quella issue è risolta, oppure quando la major di Node
passa a una che porta npm 12.

**La supply chain si controlla a ogni pull request** (roadmap 9.6), oltre alla
firma cosign, all'SBOM e alla provenance che la release allega:

- `.github/workflows/supply-chain.yml` esegue hadolint sul `Dockerfile`, e
  Trivy su `package-lock.json` e su entrambe le immagini costruite (`light` e
  `ui`). Fallisce su una vulnerabilità HIGH o CRITICAL che ha una versione
  corretta; una senza correzione non è un fallimento, perché non c'è niente a
  cui aggiornare. Gira anche ogni lunedì, così una CVE pubblicata contro una
  dipendenza che nessuno ha toccato fa comunque diventare rosso il run.
- Una CVE accettata è una voce in `.trivyignore.yaml`, il file di ignore di
  Trivy stesso, con l'id dell'advisory, uno `statement` che dice perché e una
  data `expired_at`; `paths` la restringe a dove è stata trovata.
  `npm run check:cve-exceptions` (in `ci.yml`) rifiuta una voce senza motivo o
  senza data, o con un pattern al posto dell'id, e fallisce il giorno dopo la
  scadenza. Non esiste un interruttore che spegne la scansione.
- `.github/workflows/codeql.yml` esegue le query JavaScript/TypeScript di CodeQL
  a ogni pull request e a ogni push su `dev` e `main`; i risultati finiscono
  nella scheda Security.
- `.github/workflows/scorecard.yml` esegue OpenSSF Scorecard ogni lunedì e a
  ogni push su `main` (legge solo il branch di default) e pubblica il punteggio
  dietro il badge del README.
- Entrambe le righe `FROM` del `Dockerfile` fissano `node:<major>-alpine` per
  digest, e Renovate propone il nuovo digest quando il tag viene ripubblicato.
  Le action di terze parti nei nuovi workflow sono fissate per commit con la
  versione in un commento; Renovate le sposta con il gruppo delle GitHub Actions.

**Node segue la linea LTS, di proposito con un po' di ritardo.** IsItDown gira
su una sola major di Node alla volta, sempre una linea LTS pari. Il passaggio
alla successiva (Node 28 dopo Node 26) è dovuto quando la nuova linea è
**Active LTS da circa un mese**, così le sue prime release LTS sono uscite e la
toolchain (Vite, Vitest, Playwright, Biome) si è adeguata. L'ultimo passaggio,
da Node 24 a Node 26, è arrivato a novembre 2026 (roadmap 13.13). Il passaggio è
un solo commit su `dev` e cambia insieme tutto ciò che nomina la major:

- `.nvmrc`, che CI e workflow di release leggono tramite `node-version-file`;
- `engines.node` in `package.json`, che `engine-strict` trasforma nel rifiuto
  di installare su un Node più vecchio;
- entrambe le righe `FROM node:<major>-alpine@sha256:…` del `Dockerfile`, con
  il digest del nuovo tag, e il `target`
  esbuild della build SEA in `tools/build-sea.mjs`;
- la major di `@types/node`.

Prima di fondere, si verifica ciò che la major può rompere da sola:
`node:sqlite` (lo store dell'edizione UI), il type stripping (su cui girano
`dev:ui` e `dev:docker`), e la build in un solo file: `npm run build:sea`
produce un binario dal `node` che la esegue, e quel binario deve ancora partire
e fare polling. Poi la suite completa, entrambe le immagini
(`docker compose --profile ui up -d --build` fino a `healthy`) e un run visivo.
La versione di Node è l'unico bump che cambia le immagini pubblicate senza che
cambi alcun pacchetto, quindi va in una release a sé.

### 9.8 Inventario della complessità

IsItDown fa una cosa semplice — dirti che un servizio è giù — e il codice
attorno è cresciuto fino a due edizioni, trenta canali, una CLI, gli outpost, un
binario singolo e quattro descrittori di deploy. Prima di potare o aggiungere
qualcosa sulla base di "è troppo complesso", il costo è un numero (roadmap 16.1):

```bash
node tools/complexity-inventory.mjs   # la tabella qui sotto, in Markdown
```

Per sottosistema: righe non vuote di sorgente e di test; chiavi di
`config.yml` (i percorsi foglia dello schema della Light, gli elementi di un
array contati una volta — `services` va agli adapter, `notifications` ai
notifier, il resto al core); le variabili d'ambiente che il codice legge da sé;
i controlli di form nelle superfici Impostazioni e aggiunta provider della
dashboard; i concetti che un operatore deve imparare, da una lista scritta a
mano nello script; e i target di build e di packaging con cui viene
distribuito. L'output non porta né data né tempi, quindi lo stesso albero stampa
sempre la stessa tabella.

Misurata il 2026-11-18:

| Subsystem | Source lines | Test lines | config.yml keys | Env vars | Settings fields | Concepts | Build targets |
|---|--:|--:|--:|--:|--:|--:|--:|
| Core (poller, diff engine, scheduler) | 8,110 | 8,700 | 49 | 10 | — | 39 | — |
| Adapters | 9,953 | 6,498 | 32 | 1 | — | 12 | — |
| Notifiers | 4,373 | 4,759 | 168 | — | — | 6 | — |
| Light edition | 1,254 | 973 | — | 3 | — | 4 | 2 |
| UI server | 24,492 | 18,139 | — | 19 | — | 9 | 1 |
| Dashboard | 43,523 | 17,637 | — | — | 141 | 11 | — |
| CLI | 826 | 446 | — | 1 | — | 3 | 1 |
| Outpost | 165 | 98 | — | 3 | — | 2 | — |
| Packaging | 1,308 | — | — | 1 | — | 8 | 9 |
| **Total** | 94,004 | 57,250 | 249 | 38 | 141 | 94 | 13 |

Base path (`config.example.yml`, Light): 7 keys, ceiling 7.

Il percorso base è la configurazione della
[3.0](configuration.it.md#30-il-percorso-base) — ciò che `config.example.yml`
imposta fuori da un commento. Un test
(`test/tools/complexityInventory.test.ts`) fallisce quando supera il tetto. Il
tetto è sette, non cinque: un provider del catalogo costa `id`, `name`,
`adapter` e `baseUrl`, e un canale `enabled` e le sue due credenziali; per
abbassarlo serve una modifica che tolga una di quelle chiavi, mai spostare una
chiave fuori dal percorso base.

Un concetto entra nella lista dello script nello stesso commit della funzione
che obbliga qualcuno a impararlo.

**Il budget** (roadmap 16.5). `tools/complexity-budget.mjs` mette un tetto a
sei di quei conteggi — chiavi di `config.yml`, variabili d'ambiente,
sottosistemi, target di build e packaging, adapter (`*.adapter.ts`) e canali
di notifica (`*.notifier.ts`) — come `tools/bundle-budget.mjs` fa con il peso
della dashboard:

```bash
npm run check:complexity   # i conteggi di oggi contro i loro tetti
```

Ogni tetto è il valore di oggi, senza margine, quindi qualsiasi aggiunta lo
supera. In CI questo è un'annotazione di avviso e una riga nel riepilogo della
run, non un fallimento: il budget rende visibile la crescita nel momento in
cui avviene, non la vieta. Per far tacere l'avviso si alza il tetto nel file
del budget, in un commit a sé il cui commento dice cosa è cresciuto e nomina
la issue Linear che lo giustifica. Una rimozione lascia spazio sotto il suo
tetto per un'aggiunta successiva; i tetti non si abbassano mai da soli.
