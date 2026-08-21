# IsItDown

[![Versione](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)](package.json)
[![Licenza](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2024-5FA04E?style=flat-square&logo=node.js&logoColor=white)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](tsconfig.json)
[![Dashboard](https://img.shields.io/badge/dashboard-vanilla%20JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](#92-stack-tecnologico)

[![Test](https://img.shields.io/badge/tests-301%20passing-brightgreen?style=flat-square)](#94-test-e-controlli)
[![Dipendenze runtime](https://img.shields.io/badge/runtime%20deps-3-lightgrey?style=flat-square)](#92-stack-tecnologico)
[![Docker](https://img.shields.io/badge/docker-light%20%7C%20ui-2496ED?style=flat-square&logo=docker&logoColor=white)](#4-docker)
[![i18n](https://img.shields.io/badge/i18n-en%20%7C%20it-orange?style=flat-square)](#82-localizzazione)

[English](README.md) · **Italiano**

Monitoraggio self-hosted e containerizzato delle status page **degli altri**.
Interroga le status page pubbliche dei provider da cui dipendi — GitHub, Cloudflare,
Anthropic, npm, qualunque cosa giri su Atlassian Statuspage — e ti avvisa quando uno
di loro cambia stato.

Esiste perché un singolo sviluppatore o un piccolo team abbia un preavviso sui
problemi upstream senza tenere aperte cinque dashboard di stato. Notifica sulle
*transizioni*, mai a ogni poll: una settimana tranquilla è una settimana silenziosa.

Due edizioni dallo stesso codice: **Light** (solo polling e notifiche, nessun
server) e **UI** (lo stesso motore più una dashboard locale, configurabile a runtime).

## Indice

- [1. Cosa fa](#1-cosa-fa)
  - [Principi di base](#principi-di-base)
  - [Le due edizioni](#le-due-edizioni)
- [2. Avvio rapido](#2-avvio-rapido)
  - [2.1 Con Docker](#21-con-docker)
  - [2.2 Senza Docker](#22-senza-docker)
- [3. Configurazione](#3-configurazione)
  - [3.1 Edizione Light — config.yml](#31-edizione-light--configyml)
  - [3.2 Edizione UI — impostazioni a runtime](#32-edizione-ui--impostazioni-a-runtime)
  - [3.3 Variabili d'ambiente](#33-variabili-dambiente)
  - [3.4 Come vengono gestiti i segreti](#34-come-vengono-gestiti-i-segreti)
  - [3.5 Provider monitorati](#35-provider-monitorati)
  - [3.6 Canali di notifica](#36-canali-di-notifica)
- [4. Docker](#4-docker)
  - [4.1 Immagini e target di build](#41-immagini-e-target-di-build)
  - [4.2 Profili compose](#42-profili-compose)
  - [4.3 Volumi, healthcheck, utenti](#43-volumi-healthcheck-utenti)
- [5. Verificare un deployment](#5-verificare-un-deployment)
  - [5.1 Controlli rapidi](#51-controlli-rapidi)
  - [5.2 La dashboard](#52-la-dashboard)
  - [5.3 Le modifiche di configurazione si applicano senza restart](#53-le-modifiche-di-configurazione-si-applicano-senza-restart)
  - [5.4 Test end-to-end della notifica](#54-test-end-to-end-della-notifica)
  - [5.5 Provare Telegram](#55-provare-telegram)
  - [5.6 Risoluzione dei problemi](#56-risoluzione-dei-problemi)
- [6. API HTTP](#6-api-http)
- [7. Come funziona](#7-come-funziona)
  - [7.1 Flusso dei dati](#71-flusso-dei-dati)
  - [7.2 Componenti](#72-componenti)
  - [7.3 Quando scatta una notifica](#73-quando-scatta-una-notifica)
  - [7.4 Formato delle notifiche](#74-formato-delle-notifiche)
  - [7.5 Resilienza](#75-resilienza)
- [8. Tema e localizzazione](#8-tema-e-localizzazione)
  - [8.1 Tema](#81-tema)
  - [8.2 Localizzazione](#82-localizzazione)
- [9. Sviluppo](#9-sviluppo)
  - [9.1 Struttura del repository](#91-struttura-del-repository)
  - [9.2 Stack tecnologico](#92-stack-tecnologico)
  - [9.3 Sviluppo live](#93-sviluppo-live)
  - [9.4 Test e controlli](#94-test-e-controlli)
  - [9.5 Convenzioni](#95-convenzioni)
- [10. Roadmap](#10-roadmap)
- [11. Layout dei branch e politica di merge](#11-layout-dei-branch-e-politica-di-merge)
  - [Setup, una volta per clone](#setup-una-volta-per-clone)
  - [Merge verso main](#merge-verso-main)
  - [Cosa lo fa rispettare](#cosa-lo-fa-rispettare)
  - [Conseguenze del tenere il filtro fuori da main](#conseguenze-del-tenere-il-filtro-fuori-da-main)
  - [Regole pratiche](#regole-pratiche)

---

## 1. Cosa fa

Ogni pochi minuti IsItDown recupera la status page di ogni provider, normalizza
la risposta, la confronta con quella precedente e invia un messaggio solo se è
cambiato qualcosa davvero.

```
GitHub          operational    ████████████████████████████  99.98%
Cloudflare      degraded       ███████████████▁▁▁▁▁████████  99.61%   ← ti arriva un messaggio
Anthropic       operational    ████████████████████████████  99.93%
```

### Principi di base

- **Nessuna dipendenza esterna a runtime.** Nessun database server, nessun broker,
  nessun account cloud. A questa scala bastano un file JSON o un SQLite embedded.
- **Guidato dalla configurazione.** Aggiungere un provider non significa mai
  toccare codice: una voce in `config.yml` (Light) o un dialog nella dashboard (UI).
- **Notifiche idempotenti.** Notificano solo le *transizioni* di stato: operational
  → degraded, degraded → outage, outage → resolved. Un restart non notifica nulla.
- **Indipendente dal provider.** La maggior parte gira su Atlassian Statuspage e non
  richiede codice; per tutto il resto serve un piccolo adapter.
- **Segreti solo dall'ambiente.** Nessun token viene mai scritto in un file di
  configurazione, in un database, in una risposta API o in una riga di log.

### Le due edizioni

|  | Light | UI |
|---|---|---|
| Immagine | `isitdown:light` | `isitdown:ui` (costruita `FROM` light) |
| Poller · Adapter · Diff Engine · Notifier | condivisi | condivisi |
| Configurazione | `config.yml`, riletto a ogni ciclo | SQLite, modificata dalla dashboard |
| State store | file JSON, scritture atomiche | SQLite (contiene anche la cronologia) |
| Server HTTP | assente | Express sulla :3000 |
| Cronologia uptime e grafici | — | viste 7/30/90 giorni |
| Tema | — | chiaro / scuro / sistema |
| Localizzazione | testo delle notifiche | testo delle notifiche **e** tutta la dashboard |
| Impronta | immagine 263MB, nessuna porta in ascolto | 264MB: l'immagine Light più un layer |

Entrambe le edizioni eseguono lo stesso motore. Differiscono solo per ciò che viene
iniettato: da dove arriva la configurazione e dove viene tenuto lo stato.

---

## 2. Avvio rapido

### 2.1 Con Docker

```bash
git clone https://github.com/DevManfre/isitdown.git && cd isitdown
cp .env.example .env                # compila solo i canali che abiliterai
```

**Edizione Light** — polling e notifiche, niente in ascolto:

```bash
cp config.example.yml config.yml    # modifica: provider, intervallo, canali
docker compose --profile light up -d --build
docker logs -f isitdown-light
```

**Edizione UI** — la dashboard sulla :3000, nessun `config.yml` necessario:

```bash
docker compose --profile ui up -d --build
# poi apri http://localhost:3000
```

Possono girare entrambe insieme: usano volumi dati separati.

### 2.2 Senza Docker

Richiede **Node 24**: `.nvmrc` lo fissa e `npm install` rifiuta versioni più
vecchie, perché la build si appoggia al driver SQLite integrato nel runtime e al suo
supporto TypeScript nativo.

```bash
nvm use                             # oppure: nvm install 24
npm install
cp config.example.yml config.yml
cp .env.example .env

npm run build:light && node dist/light/index.js     # Light
npm run build:ui    && node dist/ui/server.js       # UI, poi apri :3000
```

Variabili utili in locale: `CONFIG_PATH`, `DATA_PATH`, `DB_PATH`, `PORT`,
`LOG_LEVEL` (vedi [3.3](#33-variabili-dambiente)).

---

## 3. Configurazione

### 3.1 Edizione Light — `config.yml`

Un solo file, montato come volume e **riletto all'inizio di ogni ciclo**:
modificarlo ha effetto al poll successivo, senza restart. `config.example.yml` è il
template versionato; `config.yml` è in `.gitignore`, perché è la tua lista di
provider.

```yaml
pollIntervalMinutes: 3      # ogni quanto interrogare tutti i provider
requestTimeoutSeconds: 8    # timeout per singola richiesta
maxRetries: 3               # tentativi per provider per ciclo, con backoff
failureThreshold: 5         # fallimenti consecutivi prima dell'avviso "monitoring degraded"
locale: en                  # lingua dei messaggi di notifica: en | it

services:
  - name: GitHub
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com

  - name: Cloudflare
    id: cloudflare
    adapter: statuspage
    baseUrl: https://www.cloudflarestatus.com

  - name: Anthropic
    id: anthropic
    adapter: statuspage
    baseUrl: https://status.claude.com

notifications:
  telegram:
    enabled: true
    botToken: "${TELEGRAM_BOT_TOKEN}"
    chatId: "${TELEGRAM_CHAT_ID}"
  webhook:
    enabled: false
    url: "${WEBHOOK_URL}"
```

| Chiave | Default | Note |
|---|---|---|
| `pollIntervalMinutes` | `3` | 1–1440. Il ritardo reale porta un jitter di ±10%. |
| `requestTimeoutSeconds` | `8` | Per richiesta HTTP, non per ciclo. |
| `maxRetries` | `3` | Tentativi per provider per ciclo, backoff esponenziale più jitter. |
| `failureThreshold` | `5` | Cicli falliti consecutivi prima di **un** avviso "monitoring degraded". |
| `locale` | `en` | `en` o `it`; qualunque valore sconosciuto ricade su `en`. |
| `services[].id` | — | Obbligatorio. Slug minuscolo: è la chiave dello stato salvato. |
| `services[].adapter` | — | Obbligatorio. `statuspage` copre ogni pagina ospitata da Atlassian. |
| `services[].enabled` | `true` | `false` mantiene la voce ma smette di interrogarla. |

Qualunque cosa non valida ferma il container all'avvio indicando motivo e percorso:
file mancante, YAML malformato, base URL sbagliato, id duplicato, lista di servizi
vuota, o un canale abilitato il cui segreto non è impostato. Un container partito con
una configurazione capita a metà sembrerebbe sano mentre in silenzio non allerta: è
l'unico modo di fallire su cui vale la pena essere rumorosi.

### 3.2 Edizione UI — impostazioni a runtime

L'edizione UI **non** monta alcun `config.yml`; uno presente su disco verrebbe
ignorato. Tutto vive in SQLite in `/app/data/isitdown.db` e si modifica da
**Settings** nella dashboard (o tramite [`/config`](#6-api-http)):

- intervallo di polling, timeout delle richieste, numero di tentativi
- la lista dei servizi: aggiungi, modifica, rimuovi
- quali canali di notifica sono attivi e quale variabile d'ambiente porta ogni
  credenziale
- tema, lingua della dashboard, lingua delle notifiche

Le scritture hanno effetto al **ciclo di poll successivo**, senza restart, perché lo
scheduler rilegge la configurazione a ogni passaggio. Un database nuovo viene
inizializzato con GitHub, Cloudflare e Anthropic così la dashboard è subito utile; la
tua lista non viene più sovrascritta in seguito.

### 3.3 Variabili d'ambiente

| Variabile | Edizioni | Default | Scopo |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | entrambe | — | Token del bot Telegram. Obbligatoria se il canale Telegram è attivo. |
| `TELEGRAM_CHAT_ID` | entrambe | — | Chat di destinazione. Obbligatoria con la precedente. |
| `WEBHOOK_URL` | entrambe | — | Dove il webhook generico fa POST. Obbligatoria se quel canale è attivo. |
| `LOG_LEVEL` | entrambe | `info` | `debug` · `info` · `warn` · `error`. |
| `CONFIG_PATH` | Light | `/app/config/config.yml` | Dove leggere `config.yml`. |
| `DATA_PATH` | Light | `/app/data/state.json` | Dove tenere il file di stato. |
| `DB_PATH` | UI | `/app/data/isitdown.db` | Database SQLite. |
| `PORT` | UI | `3000` | Porta HTTP. |

I segreti arrivano tramite `env_file` a runtime; nulla viene incorporato in
un'immagine. `docker history` su entrambe le immagini non mostra alcun layer `ENV`
che contenga un valore.

### 3.4 Come vengono gestiti i segreti

La regola è la stessa in entrambe le edizioni — **l'ambiente è l'unico posto dove un
segreto esiste** — ma i meccanismi differiscono.

**Light.** `config.yml` contiene riferimenti `${VAR}`, risolti al caricamento. Un
canale attivo la cui variabile non è impostata è un errore fatale all'avvio che
nomina la variabile:

```
config file /app/config/config.yml: the telegram channel is enabled
but TELEGRAM_BOT_TOKEN is not set in the environment
```

**UI.** La tabella `channels` salva il **nome** della variabile
(`botTokenEnv: "TELEGRAM_BOT_TOKEN"`), mai un valore, e il nome viene risolto al
caricamento. Conseguenze da conoscere:

- Settings mostra il nome della variabile e se al momento si risolve. Il **nome** è
  modificabile; il valore no, e non esiste alcun campo in cui digitarlo.
- `PATCH /config/channels/:id` **rifiuta** una richiesta che porti un segreto
  letterale: al database non viene nemmeno offerto.
- Nessuna risposta API, nodo del DOM, riga di log o messaggio d'errore contiene un
  segreto risolto. I test lo verificano.
- Un canale attivo nel database la cui variabile non è impostata viene saltato per
  quel ciclo con un warning, invece di far crashare la dashboard: a differenza di
  Light, qui esiste una UI in cui un operatore può vederlo e sistemarlo.

È uno scostamento deliberato dal prototipo di design, che disegnava campi credenziali
modificabili.

### 3.5 Provider monitorati

Se `https://<domain>/api/v2/summary.json` restituisce JSON con `status` e
`incidents`, il provider gira su Atlassian Statuspage e **non serve codice**: basta
una voce con `adapter: statuspage`. Verificati:

| Provider | `baseUrl` |
|---|---|
| GitHub | `https://www.githubstatus.com` |
| Cloudflare | `https://www.cloudflarestatus.com` |
| Anthropic / Claude | `https://status.claude.com` |

`status.anthropic.com` risponde con un 301 verso `status.claude.com`. L'adapter segue
i redirect, quindi funzionano entrambi; l'host canonico evita il salto in più.

Lo `status.indicator` del provider viene mappato sul modello di severità interno:

| Indicator Statuspage | Stato IsItDown |
|---|---|
| `none` | `operational` |
| `minor` | `degraded` |
| `major` | `partial_outage` |
| `critical` | `major_outage` |
| non riconosciuto | `major_outage` — mai declassato in silenzio |
| assente | `unknown` |

Un incidente è *attivo* a meno che il suo stato sia `resolved` o `postmortem`.
`scheduled_maintenances` viene ignorato: il modello di severità non ha uno stato di
manutenzione.

Attenzione: un provider può riportare `degraded` con **zero** incidenti aperti —
Statuspage deriva l'indicator anche dallo stato dei componenti. Una griglia degradata
insieme a una vista Incidenti vuota è corretta, non un bug.

#### Monitorare solo una parte di un provider

Un provider può esporre centinaia di componenti: Cloudflare elenca ogni data center,
raggruppato per regione (Africa, Asia, Europa, …). Seleziona i componenti che
interessano e attiva **Segnala solo i componenti selezionati** — `scopeToComponents:
true` nel `config.yml` dell'edizione Light — per restringere tutto il provider a
quella selezione:

- un incidente che il provider attribuisce soltanto a componenti fuori dalla
  selezione viene scartato: non notifica e non finisce nei grafici né nella timeline;
- lo stato riportato del provider diventa il peggiore tra i componenti selezionati
  invece dello `status.indicator` di tutta la pagina;
- un incidente non attribuito ad alcun componente è un avviso generale e viene
  sempre segnalato;
- senza alcuna selezione il flag non fa nulla: restringere a una selezione vuota
  significherebbe silenziare il provider.

Ogni intestazione di gruppo nel picker ha la propria casella, quindi un'intera
regione è un solo clic.

Per un provider che non sta su Statuspage, aggiungi un adapter sotto `src/adapters/`.

### 3.6 Canali di notifica

| Canale | Chiave di configurazione | Variabili richieste |
|---|---|---|
| Telegram Bot API | `telegram` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Webhook generico | `webhook` | `WEBHOOK_URL` |

Il webhook fa POST di `{ change, service, message }`, così chi lo consuma può
mostrare il testo già formattato oppure fare routing sui campi strutturati:

```json
{
  "change": {
    "kind": "status_change",
    "providerId": "cloudflare",
    "previousStatus": "operational",
    "currentStatus": "major_outage",
    "at": "2026-08-19T14:32:07.000Z"
  },
  "service": { "id": "cloudflare", "name": "Cloudflare", "statusUrl": "https://www.cloudflarestatus.com" },
  "message": "🔴 Cloudflare — MAJOR OUTAGE\n\nStatus changed from Operational to Major outage.\nUpdated: 2026-08-19 14:32 UTC\n\nhttps://www.cloudflarestatus.com"
}
```

Discord e Slack hanno la stessa forma di un webhook e si innestano dietro la stessa
interfaccia `Notifier`; non sono ancora implementati.

---

## 4. Docker

### 4.1 Immagini e target di build

Un solo `Dockerfile`, tre stage. Lo stage `ui` parte `FROM light`, quindi l'immagine
UI è l'immagine Light più un unico layer sottile: immagine base, dipendenze di
produzione e tutto il motore sono condivisi su disco e in un registry.

```
builder  node:24-alpine   npm ci, tsc, copia in dist gli asset non-TS
light    node:24-alpine   dipendenze prod + dist/{core,adapters,notifiers,light}
                          VOLUME /app/config /app/data · nessun EXPOSE · nessun server
ui       FROM light       + dist/ui (dashboard e cataloghi) · EXPOSE 3000
```

```bash
docker build --target light -t isitdown:light .
docker build --target ui    -t isitdown:ui    .
```

Misurato: 12 dei 14 layer dell'immagine UI sono identici byte per byte a quelli
dell'immagine Light.

Tagga le release per edizione invece di usare un `latest` nudo, che non direbbe di
quale edizione si tratta:

```
isitdown:light-v1.0.0   isitdown:light-latest
isitdown:ui-v1.0.0      isitdown:ui-latest
```

### 4.2 Profili compose

```bash
docker compose --profile light up -d --build   # monta ./config.yml (ro) + un volume dati
docker compose --profile ui    up -d --build   # solo volume dati, pubblica la :3000
docker compose --profile light --profile ui up -d      # entrambe
docker compose --profile light --profile ui down       # ferma; i volumi sopravvivono
```

Un terzo file, `docker-compose.dev.yml`, si sovrappone al profilo `ui` ed esegue
l'edizione direttamente dal sorgente, senza alcuna build — vedi
[9.3](#93-sviluppo-live).

### 4.3 Volumi, healthcheck, utenti

| | Light | UI |
|---|---|---|
| Mount | `./config.yml:/app/config/config.yml:ro`, volume su `/app/data` | volume su `/app/data` |
| Porte | nessuna | `3000:3000` |
| Healthcheck | età di `state.json` — ogni ciclo lo riscrive, tre intervalli senza scritture è unhealthy | `GET /health` |
| Start period | 40s | 20s |
| Utente | `node`, non privilegiato | `node`, non privilegiato |

L'edizione Light non ha un server da interrogare: per questo il suo segnale di
liveness è la freschezza del file di stato e non una risposta HTTP.

Entrambi i container si fermano in modo pulito su `SIGTERM`: lo scheduler si arresta,
il ciclo in corso viene atteso, lo store viene chiuso, exit 0.

---

## 5. Verificare un deployment

Tutto ciò che segue è stato eseguito sui container costruiti. L'output atteso è
riportato accanto, così una differenza salta all'occhio.

Gli esempi passano il JSON attraverso [`jq`](https://jqlang.github.io/jq/) per
leggibilità. Non è obbligatorio: togli la pipe per vedere il body grezzo, oppure usa
il runtime che hai già:

```bash
curl -s localhost:3000/status | jq '.providers[] | {id, overallStatus}'   # con jq
curl -s localhost:3000/status | node -e 'process.stdin.toArray().then(c => {
  for (const p of JSON.parse(Buffer.concat(c)).providers) console.log(p.id, p.overallStatus);
})'                                                                       # senza
```

### 5.1 Controlli rapidi

```bash
docker ps --format "{{.Names}} {{.Status}}"
#   isitdown-light  Up 2 minutes (healthy)
#   isitdown-ui     Up 2 minutes (healthy)

docker exec isitdown-light node dist/light/healthcheck.js; echo "exit=$?"   # exit=0
docker exec isitdown-ui    node dist/ui/healthcheck.js;    echo "exit=$?"   # exit=0

docker logs -f isitdown-light
#   {"level":"info","msg":"isitdown light started",...}
#   {"level":"info","msg":"poll cycle finished","providers":3,"failed":0,"changes":0}
```

`changes:0` al primo ciclo è corretto: una prima osservazione è una baseline, non una
novità.

Conferma che l'edizione Light non esponga davvero alcun server:

```bash
docker ps --format "{{.Names}} ports={{.Ports}}" | grep light   # ports= è vuoto
docker exec isitdown-light sh -c "ps -o pid,args"            # solo node dist/light/index.js
```

Conferma che nessun segreto sia finito in un'immagine:

```bash
docker history isitdown:ui --no-trunc --format "{{.CreatedBy}}" | grep -iE "TOKEN=|SECRET="
# nessun output
```

### 5.2 La dashboard

Apri **http://localhost:3000** e percorri il rail: Overview · Providers · Incidents ·
History · Settings. Poi prova i due controlli a runtime nell'header:

- il pulsante del **tema** cicla chiaro → scuro → sistema e sopravvive a un reload;
- lo switch **EN / IT** cambia ogni stringa senza ricaricare la pagina, incluso il
  formato dell'ora (`7:36 PM` contro `19:36`) e il separatore decimale (`99.87%`
  contro `99,87%`).

Gli stessi dati via HTTP:

```bash
curl -s localhost:3000/status | jq '.providers[] | {id, overallStatus, uptime90}'
curl -s localhost:3000/history?days=7 | jq '{aggregateUptime, months}'
curl -s localhost:3000/config | jq '.channels'        # solo nomi di variabili, mai valori
curl -s -X POST localhost:3000/poll                   # forza subito un ciclo
```

Aggiungi un provider e verifica che venga preso al ciclo successivo senza restart:

```bash
curl -s -X POST localhost:3000/config/services -H 'content-type: application/json' \
  -d '{"id":"vercel","name":"Vercel","adapter":"statuspage","baseUrl":"https://www.vercel-status.com"}'

curl -s -X POST localhost:3000/config/services/vercel/test
#   {"ok":true,"overallStatus":"operational"}
```

Un test di connessione raggiunge il provider ma non registra nulla: nessun campione,
nessun incidente, nessuna notifica. È diagnostica, non cronologia.

### 5.3 Le modifiche di configurazione si applicano senza restart

**Light.** Modifica `./config.yml` sull'host: è montato in sola lettura ma riletto
all'inizio di ogni ciclo. Aggiungi un provider e abbassa l'intervallo:

```bash
docker logs -f isitdown-light
#   ..."poll cycle finished","providers":3      ← prima
#   ..."poll cycle finished","providers":4      ← dopo, senza restart
```

Misurato: aggiungere un quarto provider e portare `pollIntervalMinutes` da 3 a 1 ha
avuto effetto al ciclo successivo, e l'intervallo seguente si è ridotto a ~56s (un
minuto meno il jitter).

**UI.** Cambia l'intervallo da Settings, oppure:

```bash
curl -s -X PATCH localhost:3000/config/settings \
  -H 'content-type: application/json' -d '{"intervalMinutes":10}'
curl -s localhost:3000/status | jq .pollIntervalMinutes    # 10
```

Conferma che una configurazione non valida venga rifiutata a voce alta invece di
essere applicata a metà:

```bash
docker run --rm isitdown:light
#   ..."isitdown light failed to start","error":"config file /app/config/config.yml
#      was not found — mount it or set CONFIG_PATH"   → exit 1

printf 'services: []\n' > /tmp/bad.yml
docker run --rm -v /tmp/bad.yml:/app/config/config.yml:ro isitdown:light
#   ..."error":"config file ... is invalid: services: at least one service is required"
```

### 5.4 Test end-to-end della notifica

Aspettare un outage vero non è un test. Questo ti dà un provider di cui controlli lo
stato, più un sink che accetta il webhook: un solo container usa e getta fa entrambe
le cose.

```bash
mkdir -p /tmp/sw-test/html/api/v2
echo '{"status":{"indicator":"none"},"incidents":[]}' > /tmp/sw-test/html/api/v2/summary.json

cat > /tmp/sw-test/nginx.conf <<'CONF'
server {
  listen 80;
  location /api/v2/summary.json { root /usr/share/nginx/html; default_type application/json; }
  location /hook { access_log /dev/stdout; return 200 '{"received":true}'; }
}
CONF

docker run -d --name fake-provider --network isitdown_default \
  -v /tmp/sw-test/html:/usr/share/nginx/html:ro \
  -v /tmp/sw-test/nginx.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:alpine
```

Punta il canale webhook al sink. `WEBHOOK_URL` viene letta all'avvio del container,
quindi ricrealo:

```bash
sed -i 's|^WEBHOOK_URL=.*|WEBHOOK_URL=http://fake-provider/hook|' .env
docker compose --profile ui up -d --force-recreate
```

Registra il provider finto e abilita il canale:

```bash
curl -s -X POST localhost:3000/config/services -H 'content-type: application/json' \
  -d '{"id":"fake","name":"Fake Provider","adapter":"statuspage","baseUrl":"http://fake-provider"}'
curl -s -X PATCH localhost:3000/config/channels/webhook \
  -H 'content-type: application/json' -d '{"enabled":true}'
```

Ora guida le transizioni:

```bash
# 1. baseline — non deve inviare nulla
curl -s -X POST localhost:3000/poll | jq '{changes}'        # {"changes": 0}

# 2. rompilo
cat > /tmp/sw-test/html/api/v2/summary.json <<'JSON'
{"status":{"indicator":"critical"},
 "incidents":[{"id":"fake-1","name":"Everything is on fire","impact":"critical",
               "status":"investigating","updated_at":"2026-08-19T18:00:00.000Z"}]}
JSON
curl -s -X POST localhost:3000/poll | jq '{changes}'        # {"changes": 2}

# 3. poll di nuovo senza cambiare niente — deve restare in silenzio
curl -s -X POST localhost:3000/poll | jq '{changes}'        # {"changes": 0}

curl -s localhost:3000/notifications | jq -r '.notifications[] | "\(.ok) \(.kind) \(.text | split("\n")[0])"'
#   true incident_opened 🔴 Fake Provider — MAJOR OUTAGE
#   true status_change   🔴 Fake Provider — MAJOR OUTAGE
```

Il feed è ordinato dal più recente e persiste nel volume dati, quindi un database che
ha già visto altre esecuzioni mostrerà le loro voci sotto queste due.

Ripristino, e sicurezza al restart:

```bash
echo '{"status":{"indicator":"none"},"incidents":[]}' > /tmp/sw-test/html/api/v2/summary.json
curl -s -X POST localhost:3000/poll | jq '{changes}'        # {"changes": 2} → resolved + operational

docker compose --profile ui restart
curl -s -X POST localhost:3000/poll | jq '{changes}'        # {"changes": 0} — nulla rinotificato
curl -s localhost:3000/incidents | jq '.closed[] | {incidentId, startedAt, resolvedAt}'
```

Lo stesso flusso funziona sull'edizione Light: aggiungi il provider finto a
`config.yml`, metti `webhook.enabled: true`, e il log mostra gli invii:

```
..."poll cycle finished","providers":4,"failed":0,"changes":2
..."notification sent","channel":"webhook","providerId":"fake","kind":"status_change"
..."notification sent","channel":"webhook","providerId":"fake","kind":"incident_opened"
```

Pulizia:

```bash
docker rm -f fake-provider
curl -s -X DELETE localhost:3000/config/services/fake
curl -s -X PATCH localhost:3000/config/channels/webhook \
  -H 'content-type: application/json' -d '{"enabled":false}'
sed -i 's|^WEBHOOK_URL=.*|WEBHOOK_URL=|' .env
rm -rf /tmp/sw-test
```

### 5.5 Provare Telegram

Telegram è il canale che la maggior parte delle persone vuole davvero, e quello su cui
conviene fare una prova reale. Crea un bot con [@BotFather](https://t.me/botfather),
mandagli un messaggio, poi leggi il tuo chat id da
`https://api.telegram.org/bot<TOKEN>/getUpdates`.

```bash
sed -i 's|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=123456:AA...|' .env
sed -i 's|^TELEGRAM_CHAT_ID=.*|TELEGRAM_CHAT_ID=-1001234567890|' .env
docker compose --profile ui up -d --force-recreate

curl -s -X PATCH localhost:3000/config/channels/telegram \
  -H 'content-type: application/json' -d '{"enabled":true}'
curl -s -X POST localhost:3000/config/channels/telegram/test    # {"ok":true}
```

Un fallimento torna come `{"ok":false,"error":"telegram notification failed: HTTP 400 (chat not found)"}`:
il codice di stato e la descrizione di Telegram, mai il token.

Per l'edizione Light imposta le stesse due variabili, `telegram.enabled: true` in
`config.yml`, e riavvia il container perché prenda i segreti.

### 5.6 Risoluzione dei problemi

| Sintomo | Causa probabile |
|---|---|
| Il container Light esce subito, exit 1 | Configurazione. `docker logs` indica file, percorso e motivo. |
| `the telegram channel is enabled but TELEGRAM_BOT_TOKEN is not set` | `.env` non viene passato. Controlla `env_file` e ricrea il container: l'ambiente si legge all'avvio. |
| Container fermo su `starting` per sempre | L'healthcheck non è mai passato. Light: `state.json` non viene scritto, quindi nessun ciclo è andato a termine. UI: `/health` non risponde. |
| La dashboard carica ma la griglia è vuota | Nessun ciclo è ancora girato. `POST /poll`, oppure aspetta un intervallo. |
| Un provider mostra `unknown` | Non è mai stato interrogato con successo. `POST /config/services/<id>/test` riporta l'errore reale. |
| Il provider è `degraded` ma Incidents è vuoto | Corretto. Statuspage deriva l'indicator anche dallo stato dei componenti: può non esistere alcun incidente registrato. |
| L'uptime di un provider è `0%` | Ha esattamente un campione e non era operational. Sale con i cicli successivi. |
| Una colonna del mese mostra `—` | Nessun campione in quel mese. Volutamente non `0%`, che si leggerebbe come un outage lungo un mese. |
| Non arriva mai nessuna notifica | Il canale è `enabled` e la sua variabile si risolve? `GET /config` mostra `isSet` per ogni campo. Poi `POST /config/channels/<id>/test`. |
| Arrivano notifiche ripetute per la stessa cosa | Non dovrebbe essere possibile: decide solo il diff engine. Raccogli `docker logs` e il feed `/notifications`. |
| La dashboard mostra chiavi grezze tipo `nav.overview` | Un catalogo non si è caricato. Controlla `GET /locales/en.json`. |

Alza il dettaglio con `LOG_LEVEL=debug`, che logga ogni singolo tentativo di poll,
retry compresi.

---

## 6. API HTTP

Solo edizione UI. Ogni risposta è JSON, errori compresi
(`{ "error": { "message": "..." } }`): una fetch dal browser che si ritrova una pagina
HTML di errore segnala un errore di parsing invece del problema vero.

| Metodo | Percorso | Scopo |
|---|---|---|
| `GET` | `/health` | Liveness. `{ status, providers, lastCycleAt }`. |
| `GET` | `/status` | Stato corrente di ogni provider, più ultimo e prossimo poll. Pura lettura dal database — si può interrogare ogni 30s, come fa la dashboard. Non raggiunge mai l'upstream. |
| `GET` | `/history?provider=&days=` | Bucket giornalieri pre-aggregati, uptime a 7/30/90 giorni, colonne dei mesi. `days` accetta `7`, `30` o `90`; altro è un 400 che li elenca. Senza `provider`, un riepilogo su tutti. |
| `GET` | `/incidents?provider=` | `{ active, closed }`. |
| `GET` | `/incidents/:providerId/:incidentId` | Dettaglio: l'incidente, la cronologia osservata, il log di ciò che è stato inviato, gli altri incidenti aperti del provider e gli ultimi 24 poll. |
| `GET` | `/notifications?limit=` | Ciò che è stato inviato davvero, dal più recente. Massimo 200. |
| `GET` | `/config` | Servizi, impostazioni di polling, canali. Le credenziali dei canali appaiono come **nomi** di variabili con un flag `isSet`, mai come valori. |
| `POST` | `/config/services` | Aggiunge un servizio. `201`, oppure `409` su id duplicato, oppure `400` col nome del campo non valido. |
| `PATCH` `DELETE` | `/config/services/:id` | Modifica o rimozione. La cancellazione propaga a campioni, incidenti e stato di quel provider, così non sopravvive nulla orfano. |
| `PATCH` | `/config/settings` | Impostazioni di polling. |
| `PATCH` | `/config/channels/:id` | Attiva/disattiva e imposta i nomi delle variabili. **Rifiuta** un segreto letterale. |
| `POST` | `/config/services/:id/test` | Una fetch reale verso quel provider. Non registra nulla. |
| `POST` | `/config/channels/:id/test` | Una notifica di test, attraverso il dispatcher. |
| `GET` `PATCH` | `/api/preferences` | `{ theme, uiLocale, notificationLocale }`. |
| `GET` | `/locales/:lang.json` | Catalogo della dashboard. `404` per una lingua senza catalogo, così il client ricade su `en`. |
| `POST` | `/poll` | Esegue subito un ciclo, tramite lo scheduler. Restituisce il riepilogo del ciclo. |
| `GET` | `/` | La dashboard. |

### 6.1 Backfill dello storico

All'avvio — e ogni volta che un provider viene aggiunto dalla dashboard —
l'edizione UI ricostruisce fino a 90 giorni di storico dal feed pubblico
degli incidenti del provider (`/api/v2/incidents.json` per i provider basati
su Statuspage), così le barre di uptime non partono vuote su un container
nuovo.

Lo storico ricostruito è derivato, non misurato: un giorno è segnato come
degradato o down solo se un incidente noto lo ha attraversato, e i giorni
coperti senza incidenti sono considerati operativi. Il feed pubblico
restituisce al massimo i 50 incidenti più recenti, quindi la copertura varia
per provider; i giorni oltre la portata del feed restano grigi ("nessun
dato") ed esclusi dalle percentuali di uptime. Il backfill non genera mai
notifiche e non sovrascrive mai campioni osservati.

Non c'è autenticazione: questa è una dashboard locale per un singolo operatore. Non
pubblicare la porta 3000 su una rete di cui non ti fidi.

---

## 7. Come funziona

### 7.1 Flusso dei dati

```
                 ┌──────────────┐
                 │  Scheduler   │  setTimeout riarmato dopo ogni ciclo, jitter ±10%
                 └──────┬───────┘
                        │ a ogni ciclo, riletta da zero
                        ▼
                 ┌──────────────┐         config.yml (Light)
                 │ ConfigSource │◀────────  oppure SQLite (UI)
                 └──────┬───────┘
                        ▼
   ┌────────────────────────────────────┐      ┌──────────────┐
   │              Poller                │─────▶│   Adapter    │──▶ status page dei provider
   │  sfasa · ritenta · isola i guasti  │      └──────────────┘
   └──────┬──────────────────────┬──────┘
          │ stato precedente     │ stato nuovo
          ▼                      ▼
   ┌──────────────┐       ┌──────────────┐
   │  StateStore  │       │ Diff Engine  │  l'unica cosa che decide
   │ JSON │ SQLite│       └──────┬───────┘  se qualcosa notifica
   └──────────────┘              │ StatusChange[]  (di solito vuoto)
                                 ▼
                        ┌────────────────┐
                        │   Dispatcher   │  l'unico chiamante di Notifier.send
                        └───────┬────────┘
                                ▼
                        Telegram · webhook

   Solo edizione UI: un server Express nello stesso processo serve dashboard e API
   dallo stesso StateStore, e può chiedere allo scheduler un ciclo immediato.
```

Il motore è indipendente dall'edizione. `src/core`, `src/adapters` e `src/notifiers`
non importano mai da `src/light` o `src/ui` — un test lo impone. Le edizioni
differiscono solo per il `ConfigSource` e lo `StateStore` che iniettano.

### 7.2 Componenti

1. **Scheduler** — esegue subito un ciclo, poi riarma un `setTimeout` all'intervallo
   ±10% di jitter, così un ciclo lento ritarda il successivo invece di sovrapporsi e
   una flotta di istanze non colpisce mai un provider all'unisono. Rilegge la
   configurazione a ogni ciclo: è questo che fa avere effetto alle modifiche dalla UI
   senza restart. Un ciclo che solleva un errore viene loggato e il loop continua.

2. **Poller** — sfasa i provider di 250ms l'uno dall'altro, poi li esegue sotto
   `Promise.allSettled` così il guasto di un provider non può toccare il risultato di
   un altro. Fino a `maxRetries` tentativi ciascuno, backoff esponenziale più jitter,
   ogni richiesta col proprio timeout. Esauriti i tentativi registra il fallimento e
   lascia intatto lo stato salvato.

3. **Adapter** — trasformano la risposta grezza di un provider nella forma
   normalizzata:

   ```ts
   interface NormalizedStatus {
     provider: string;                 // "github"
     overallStatus: "operational" | "degraded" | "partial_outage" | "major_outage" | "unknown";
     activeIncidents: { id: string; name: string; impact: string; status: string; updatedAt: string }[];
     fetchedAt: string;                // ISO 8601, UTC
   }
   ```

   `statuspage.adapter.ts` è generico e si configura col solo base URL, il che copre
   ogni pagina ospitata da Atlassian. Solleva un errore su guasto di rete, non-2xx o
   body non parsabile così il retry del poller può agire, ma degrada senza rumore su
   un singolo campo mancante: un incidente senza titolo diventa una stringa vuota, non
   un crash. Il payload è validato con `zod`; una pagina di login o un blob d'errore
   vengono rifiutati.

4. **State Store** — l'ultimo `NormalizedStatus` noto per provider, il conteggio dei
   fallimenti consecutivi e se l'avviso "monitoring degraded" è già stato inviato.
   Light scrive un file JSON tramite file temporaneo e rename, così un crash a metà
   scrittura non può troncarlo; UI usa il `node:sqlite` integrato e registra anche la
   cronologia che leggono i grafici. Entrambi passano la stessa suite di contratto,
   quindi sono dimostrabilmente interscambiabili.

   Una fetch fallita non sovrascrive mai lo stato salvato. Conservare l'ultimo stato
   noto è ciò che impedisce al poll riuscito successivo di essere riportato come un
   ripristino mai avvenuto.

5. **Diff Engine** — puro, sincrono, e unica autorità su se qualcosa notifichi. Vedi
   [7.3](#73-quando-scatta-una-notifica).

6. **Dispatcher** — l'unico chiamante di `Notifier.send` in entrambe le edizioni. Un
   payload per cambiamento per canale attivo, tutti sotto `Promise.allSettled`: il
   guasto di un canale viene registrato e loggato ma non blocca mai un altro canale né
   un altro cambiamento. I notifier vengono ricostruiti dalla configurazione a ogni
   ciclo, ed è per questo che attivare un canale non richiede restart.

7. **Notifier** — Telegram e webhook generico. La composizione del messaggio è
   condivisa (`src/notifiers/formatting.ts`), così i canali non possono divergere su
   ciò che riportano; cambia solo il trasporto. Emoji e impaginazione stanno nel
   notifier, le parole arrivano dai cataloghi condivisi.

### 7.3 Quando scatta una notifica

Questa tabella **è** il comportamento: è la suite di test del diff engine, e i nuovi
casi limite si aggiungono come righe invece che come test isolati.

| Precedente | Nuovo | Notifica |
|---|---|---|
| ancora nulla (primo poll) | qualunque cosa | **no** — una baseline non è una novità, così un container appena avviato non fa raffiche |
| operational | operational | no |
| operational | degraded | sì — `status_change` |
| degraded | major_outage | sì — escalation |
| major_outage | operational | sì — `status_change` più `incident_resolved` |
| qualunque | compare un nuovo id di incidente | sì — `incident_opened` per incidente |
| qualunque | stesso incidente, cambia `status` o `impact` | sì — `incident_updated` |
| qualunque | stesso incidente, cambia solo `updatedAt` o il titolo | **no** — un provider che aggiorna un timestamp non è un evento |
| qualunque | stessi incidenti, ordine diverso | **no** — il confronto è per id, l'ordine non può generare falsi positivi |
| `unknown` | qualunque cosa | **nessun** `status_change` — non c'è una baseline reale da confrontare |
| qualunque | `unknown` | **nessun** `status_change` — una transizione *verso* "non lo sappiamo" non è una novità |
| N cicli falliti consecutivi | | sì, **una volta** — `monitoring_degraded`, e non di nuovo finché un successo non lo azzera |

Un restart non notifica nulla: lo stato viene ricaricato dallo store, e lo stato
ricaricato risulta uguale a quello che lo ha prodotto. Entrambe le implementazioni
dello store sono testate su questo.

### 7.4 Formato delle notifiche

```
🔴 GitHub — MAJOR OUTAGE

Incident: API requests failing intermittently
Status: Investigating
Updated: 2026-08-19 14:32 UTC

https://www.githubstatus.com
```

```
🟢 GitHub — RESOLVED

Incident "API requests failing intermittently" has been resolved.
Updated: 2026-08-19 15:10 UTC

https://www.githubstatus.com
```

```
⚪ AWS — monitoring degraded

5 consecutive fetches failed. Last known status: Operational.
Updated: 2026-08-19 22:04 UTC
```

Emoji per severità: 🟢 operational · 🟡 degraded · 🟠 partial outage · 🔴 major
outage · ⚪ unknown. Un avviso di monitoraggio è sempre ⚪: riguarda il recupero dati
di IsItDown, non lo stato del provider, quindi non ne prende mai il colore. I
timestamp restano UTC con suffisso esplicito in ogni lingua.

### 7.5 Resilienza

- **Provider irraggiungibile** — logga, conserva l'ultimo stato noto, ritenta al ciclo
  successivo. Dopo `failureThreshold` cicli falliti consecutivi, un avviso "monitoring
  degraded"; mai un silenzio per sempre.
- **Risposta malformata** — validata al confine. Un campo opzionale mancante degrada;
  un body fondamentalmente rotto solleva un errore così retry e conteggio dei
  fallimenti possono agire. Un provider guasto non fa mai crashare un ciclo.
- **Notifiche duplicate** — impedite strutturalmente: il diff engine è l'unica cosa
  che decide, e il dispatcher l'unica che invia.
- **Restart** — lo stato viene ricaricato dallo store, quindi nessuna falsa raffica di
  "è cambiato tutto". Testato in entrambe le edizioni, anche nel container.
- **Rate limiting** — i provider sono sfasati all'interno del ciclo e l'intervallo
  porta jitter, così né una singola istanza né una flotta martellano un provider nello
  stesso secondo.
- **Timestamp non affidabili** — un `updatedAt` del provider avanti rispetto al nostro
  orologio non può far iniziare un incidente nel futuro; l'orario di inizio è ancorato
  al poll che lo ha visto per primo, mentre la data dichiarata dal provider resta
  registrata.
- **Scritture concorrenti** — un ciclo modifica lo stato di tutti i provider insieme,
  quindi lo store su file serializza le scritture e dà a ognuna il proprio file
  temporaneo.

---

## 8. Tema e localizzazione

### 8.1 Tema

Edizione UI. Tre stati: **chiaro / scuro / sistema**, ciclati dall'header.

- **Token, non colori per componente.** Ogni colore è una custom property CSS.
  `css/tokens.css` è l'unico file della dashboard a cui è permesso contenere un colore
  letterale, e un test lo impone. La palette chiara sta su `:root` nudo, quella scura
  la sovrascrive in `:root[data-theme="dark"]`, e le stesse sovrascritture sono
  replicate sotto `prefers-color-scheme: dark` protette da
  `:root:not([data-theme="light"])` così "sistema" funziona in entrambe le direzioni.
  Tutti e tre i blocchi dichiarano un set di token identico, e anche questo è
  verificato da un test: un token definito in un solo tema si renderizzerebbe male.
- **I grafici leggono gli stessi token**, quindi non hanno mai bisogno di una palette
  scura separata.
- **Sistema è il default.** Senza una scelta esplicita il tema segue il sistema
  operativo e reagisce ai suoi cambi dal vivo, senza reload.
- **Persistito due volte**: in `localStorage`, così lo script inline nel `<head>` può
  applicarlo *prima del primo paint* ed evitare il lampo del tema sbagliato; e nella
  tabella delle impostazioni, così un browser nuovo sulla stessa istanza riparte da
  dove avevi lasciato.
- **Palette**: Nocturne, dal prototipo Claude Design. La modalità chiara legge le
  stesse rampe tonali dall'altro capo — nessun colore è stato inventato, comprese le
  cinque tinte di severità, che hanno un valore proprio per tema.

### 8.2 Localizzazione

Due livelli, con `en` come lingua di partenza e fallback in entrambi:

| Livello | File | Usato da |
|---|---|---|
| Testo delle notifiche | `src/core/i18n/<lang>.json` | entrambe le edizioni |
| Testo della dashboard | `src/ui/public/locales/<lang>.json` | edizione UI |

Regole imposte dai test, non solo documentate:

- **Nessun letterale visibile all'utente nel codice.** Ogni stringa è una chiave
  piatta con punti; il valore vive in un catalogo. Output del logger, messaggi di
  `Error`, id degli adapter e percorsi delle route sono rivolti agli sviluppatori e
  restano in inglese semplice.
- **Ogni catalogo ha esattamente l'insieme di chiavi di `en`**, e ogni valore tradotto
  porta gli stessi placeholder nominati della sorgente. Una stringa non può uscire
  tradotta a metà.
- **Ogni chiave che la dashboard richiede esiste** — un errore di battitura si
  renderizzerebbe come la chiave stessa nel browser.
- **Mai comporre una frase da frammenti tradotti.** L'ordine delle parole cambia da
  lingua a lingua, quindi una chiave contiene l'intera frase. I plurali sono chiavi
  separate `.one`/`.other` selezionate con `Intl.PluralRules`.
- **Date, numeri, percentuali e durate** passano da `Intl.*` nella lingua attiva. I
  timestamp delle notifiche sono l'eccezione deliberata: sempre UTC con suffisso
  esplicito, così un operatore che legge avvisi in due lingue non deve mai indovinare.
- La lingua della dashboard e quella delle notifiche sono **impostazioni separate**:
  una UI in inglese può mandare avvisi in italiano.
- Aggiungere una lingua è un file JSON per livello. Nessuna modifica al codice.

In distribuzione: `en` e `it`. La risoluzione della lingua è la preferenza salvata,
poi `en`.

> Le stringhe italiane sono state scritte insieme all'implementazione e non hanno
> avuto una revisione da madrelingua. Vale anche per questo documento.

---

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
│   │   ├── diffEngine.ts              l'unica autorità su se una notifica scatta
│   │   ├── notificationDispatcher.ts  l'unico chiamante di Notifier.send
│   │   ├── scheduler.ts               il loop; rilegge la configurazione a ogni ciclo
│   │   ├── logger.ts
│   │   └── i18n/                      stringhe delle notifiche, indipendenti dall'edizione
│   │       ├── index.ts               lookup + fallback su en + formattazione UTC
│   │       ├── en.json                lingua di partenza
│   │       └── it.json
│   ├── adapters/                      (condiviso)
│   │   ├── statuspage.adapter.ts      adapter generico Atlassian Statuspage
│   │   └── index.ts                   registro per id di adapter
│   ├── notifiers/                     (condiviso)
│   │   ├── formatting.ts              emoji, etichette di severità, composizione del messaggio
│   │   ├── telegram.notifier.ts
│   │   ├── webhook.notifier.ts
│   │   └── index.ts                   registro per id di canale
│   ├── light/                         (solo edizione Light)
│   │   ├── index.ts                   entrypoint
│   │   ├── runtime.ts                 wiring, condiviso col test end-to-end
│   │   ├── healthcheck.ts             freschezza del file di stato
│   │   ├── fileStateStore.ts          file JSON, scritture atomiche
│   │   └── config/
│   │       ├── schema.ts              forma di config.yml
│   │       └── loadConfig.ts          YAML + sostituzione ${ENV} + validazione
│   └── ui/                            (solo edizione UI)
│       ├── server.ts                  entrypoint
│       ├── runtime.ts                 wiring, condiviso coi test delle API
│       ├── app.ts                     app Express: route, dashboard statica, errori JSON
│       ├── healthcheck.ts             interroga /health
│       ├── sqliteStateStore.ts        StateStore + cronologia, una transazione per salvataggio
│       ├── historyStore.interface.ts  il contratto della cronologia (la UI ne è l'unico consumatore)
│       ├── history.ts                 aggregazione di uptime e incidenti
│       ├── dbConfigSource.ts          configurazione da SQLite; risolve i segreti per nome di variabile
│       ├── db/                        open.ts, migrate.ts, seed.ts
│       ├── routes/                    status, history, incidents, notifications, config, preferences
│       └── public/                    la dashboard: nessun framework, nessun bundler
│           ├── index.html             script del tema pre-paint, rail, header, contenitore delle viste
│           ├── css/tokens.css         l'unico file con un colore letterale
│           ├── css/nocturne.css       livello dei componenti del design system
│           ├── css/app.css            layout della console
│           ├── js/                    app (router), api, i18n, theme, charts, components/, views/
│           └── locales/               en.json (sorgente) + it.json
├── tools/
│   └── copy-assets.mjs                copia in dist i cataloghi i18n e la dashboard
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
├── design/                            prototipi Claude Design (in .gitignore: su disco, non in un clone)
├── Dockerfile                         builder → light → ui (ui è FROM light)
├── docker-compose.yml                 entrambe le edizioni come profili
├── docker-compose.dev.yml             override di sviluppo: edizione UI live da src/, senza build
├── config.example.yml                 template versionato; config.yml è in .gitignore
├── .env.example                       nomi delle variabili dei segreti, mai valori
├── .nvmrc  .npmrc                     fissano Node 24 e fanno fallire in modo esplicito una versione più vecchia
├── tsconfig.json                      TypeScript del server
├── tsconfig.light.json                la build Light: esclude src/ui
└── tsconfig.public.json               checkJs sulla dashboard, che non ha uno step di build
```

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
| Test runner | `node:test` integrato | |
| Dashboard | Express + moduli ES vanilla e CSS puro | Nessun framework, nessun bundler, nessuna libreria di grafici. |
| Container | un `Dockerfile` multi-stage | `--target light` / `--target ui`, `node:24-alpine`. |

Dipendenze a runtime, tutte: `zod`, `yaml` (entrambe le edizioni) ed `express` (UI).
Dipendenze di sviluppo: `typescript`, `@types/node`, `@types/express`.

### 9.3 Sviluppo live

Ricostruire l'immagine per una riga di CSS è abbastanza lento da scoraggiare la
modifica stessa. Node 24 rimuove i tipi TypeScript al caricamento, quindi l'edizione
UI può girare da `src/` senza alcuna build:

```bash
npm run dev:docker   # container: docker-compose.dev.yml sovrapposto al profilo ui
npm run dev:ui       # processo locale, database in ./data/isitdown.db
```

`docker-compose.dev.yml` sovrascrive solo il servizio `isitdown-ui`: `./src` viene
montato in sola lettura su `/app/src` e il comando diventa Vite in watch mode
insieme a `node --watch src/ui/server.ts`. L'immagine è la sua: l'override costruisce
il target `dev` e la tagga `isitdown:dev`, perché la modalità di sviluppo ha bisogno
delle dipendenze di sviluppo che la build di produzione scarta — e perché una build di
sviluppo non deve mai sovrascrivere `isitdown:ui`, il tag che risolve il profilo `ui`.
Il middleware statico risolve la dashboard
rispetto al modulo da cui gira, quindi partendo da `src/` serve `src/ui/public` e non
il `dist/ui/public` incluso nell'immagine.

| Modifica | Cosa succede |
|---|---|
| `src/ui/public/**` — CSS, JS della dashboard, HTML, cataloghi | Servita dal sorgente montato: hard refresh (Ctrl+Shift+R), nessun restart |
| un qualsiasi `.ts` | `node --watch` riavvia il server in circa un secondo; scheduler e backfill ripartono con lui |
| una dipendenza o il `Dockerfile` | Ricostruire una volta l'immagine di sviluppo: `npm run dev:docker -- --build` |

Due cose che la modalità di sviluppo non fa. Non esegue il type-check — rimuovere i
tipi non è compilarli, quindi `npm run typecheck` resta obbligatorio. E il solo
`dist/` che produce è il bundle React di Vite, scritto dentro il container e buttato
via con lui, quindi il rilascio passa comunque dalla via normale:

```bash
docker compose --profile ui up -d --build   # si torna all'immagine costruita
```

Entrambe le modalità riusano il nome container `isitdown-ui` — di proposito, perché è
questo che le rende mutuamente esclusive su porta e database — quindi per distinguerle
si guarda l'immagine o il comando. `docker compose ps` mostra `isitdown:ui` per
l'immagine costruita e `isitdown:dev` per la modalità di sviluppo; `docker inspect -f
'{{.Config.Cmd}}' isitdown-ui` mostra `node dist/ui/server.js` per l'immagine
costruita e `node --watch src/ui/server.ts`, dietro il watcher di Vite, per la
modalità di sviluppo.

### 9.4 Test e controlli

```bash
npm test                 # suite unitaria:   test/**/*.test.ts
npm run test:integration # suite end-to-end: test/**/*.itest.ts
npm run typecheck        # TypeScript del server, più il JS della dashboard via checkJs
npm run build:light      # tsc + copia asset, escludendo src/ui
npm run build:ui         # tsc + copia asset, tutto
```

**Nessun test raggiunge mai un provider reale.** Gli adapter sono testati contro
payload registrati dalle status page vere e conservati sotto `test/fixtures/`; il
comportamento HTTP gira contro un server locale.

Suite notevoli:

- **Diff engine** — l'intera tabella di [7.3](#73-quando-scatta-una-notifica),
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
- **Guardie su tema e lingue** — nessun esadecimale fuori dal file dei token, set di
  token identici tra i temi, parità dei cataloghi, e ogni chiave `t()` che si risolve.
- **End to end** — un provider finto e un ricevitore webhook: una transizione consegna
  esattamente una notifica, un ciclo invariato nessuna, un restart nessuna, un provider
  irraggiungibile conserva l'ultimo stato noto, e l'entrypoint resta vivo tra i cicli e
  esce con 0 su `SIGTERM`.

Dato che la dashboard non ha uno step di build, `tsc --checkJs` gira anche su di lei: è
il solo controllo statico che quel codice riceve.

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
- Commit: `<emoji> <TITOLO> - <descrizione>`, in inglese, gitmoji.

---

## 10. Roadmap

Consegnato:

- **v1 — edizione Light**: polling, diff engine, notifiche Telegram e webhook
  generico, `config.yml` con segreti referenziati dall'ambiente, state store JSON con
  scritture atomiche, `isitdown:light`.
- **v1.1 — prototipazione UI**: la dashboard esplorata in Claude Design e conservata in
  `design/claude-design-prototypes/`. L'opzione `3a`, la console navigabile, è il
  riferimento per l'implementazione; la palette scura e le etichette italiane più
  lunghe sono state validate lì invece di essere scoperte dopo.
- **v1.2 — edizione UI**: quel design come dashboard Express + moduli ES vanilla su
  SQLite, con la configurazione gestita a runtime e applicata al ciclo successivo senza
  restart. `isitdown:ui`, costruita `FROM` l'immagine Light.
- **v1.3 — cronologia**: uptime e cronologia incidenti per provider con le barre
  giornaliere in stile status page e le viste 7/30/90 giorni, aggregate lato server e
  servite da `/history`.
- **v1.4 — tema scuro e i18n**: tema chiaro/scuro/sistema basato su token con
  preferenza persistita, e dashboard localizzata (`en`, `it`) sopra i messaggi di
  notifica localizzati che entrambe le edizioni già condividevano.

Ancora aperto:

- Adapter per provider che non stanno su Atlassian Statuspage.
- Canali Discord e Slack con rich embed: hanno entrambi la forma di un webhook, quindi
  si innestano dietro l'interfaccia `Notifier` esistente.
- Routing multi-destinatario: canali diversi per provider o per severità.
- Consapevolezza delle manutenzioni programmate. L'adapter ignora
  `scheduled_maintenances` di Statuspage, e il modello di severità non ha uno stato di
  manutenzione.
- Dettaglio a livello di componente. L'adapter normalizza lo stato complessivo di un
  provider e i suoi incidenti, non i singoli componenti, quindi la vista incidente
  mostra gli altri incidenti aperti del provider dove il prototipo disegnava un
  pannello dei componenti.
- Una revisione madrelingua delle stringhe italiane.

Non-obiettivi espliciti: autenticazione multi-utente (questa è una dashboard locale per
un singolo operatore), status page dietro login, e un'app mobile pacchettizzata.

---

## 11. Layout dei branch e politica di merge

Il tooling di Claude Code (`.claude/`, `CLAUDE.md`) e il filtro di merge stesso
(`.mergeexclude`, `.githooks/`, `scripts/`) sono versionati **solo su `dev`**. Su
`main` nessuno di quei percorsi esiste, né nel commit né nel working tree. Tutto il
resto (sorgenti, documentazione, configurazione) passa normalmente da `dev` a `main`.

Poiché il filtro non è leggibile da `main`, viene installato nella directory `.git` di
questo clone, che tutti i branch condividono.

### Setup, una volta per clone

```bash
git switch dev
scripts/setup-hooks.sh
```

Copia:

| Da (`dev`) | A (condiviso da ogni branch) |
|---|---|
| `scripts/git-merge-clean` | `$GIT_DIR/merge-clean` |
| `.githooks/*` | `$GIT_DIR/hooks/*` |
| `.mergeexclude` | `$GIT_DIR/merge-exclude` |

e installa l'alias `git mergeclean`. Rieseguilo dopo aver modificato `.mergeexclude`
o `scripts/git-merge-clean`.

### Merge verso `main`

```bash
git switch main
git mergeclean dev        # non `git merge dev`
```

`git mergeclean` fa il merge del branch, elimina i percorsi elencati nella lista di
esclusione, committa col formato di subject `🔀` del repository e rimuove quei percorsi
dal working tree. Si rifiuta di partire su un albero sporco. I conflitti veri fuori dai
percorsi esclusi fermano l'esecuzione così puoi risolverli e fare `git commit` come al
solito.

### Cosa lo fa rispettare

| Pezzo | Ruolo |
|---|---|
| `$GIT_DIR/merge-exclude` | la lista dei percorsi |
| `$GIT_DIR/merge-clean` | il wrapper di merge (`--sync` elimina, `--guard` controlla) |
| `$GIT_DIR/hooks/post-checkout` | elimina i percorsi esclusi dopo un cambio di branch |
| `$GIT_DIR/hooks/pre-merge-commit`, `pre-commit` | interrompono qualunque commit che aggiungerebbe un percorso escluso a un branch che non lo traccia |

Un `git merge dev` semplice su `main` viene rifiutato dagli hook di guardia: esegui
`git merge --abort` e usa `git mergeclean`. `git commit --no-verify` aggira la guardia
se ti serve davvero.

### Conseguenze del tenere il filtro fuori da `main`

- **Il setup è per clone e non può essere automatico.** Git non esegue mai hook presi
  da un clone, e un clone che fa checkout solo di `main` non ha nulla da cui
  installare. Su una macchina nuova, fai checkout di `dev` ed esegui il setup prima di
  fare merge verso `main`.
- **Finché il setup non viene eseguito, non è imposto nulla.** Un `git merge dev`
  semplice su un clone appena fatto porterà `.claude/` e `CLAUDE.md` dentro `main`
  appena risolvi i conflitti che solleva.

### Regole pratiche

- Modifica `.claude/`, `CLAUDE.md`, `.mergeexclude`, `.githooks/` e `scripts/` solo
  stando su `dev`: su `main` non esistono.
- L'eliminazione cancella solo i file che anche `dev` ha e che sono identici byte per
  byte, quindi i file locali della macchina (`.claude/settings.local.json`) e le
  modifiche locali non vengono mai toccati.
