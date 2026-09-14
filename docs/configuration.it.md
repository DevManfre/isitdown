[← README](../README.it.md)

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
adaptivePolling: true       # con un incidente aperto, interroga il provider con la cadenza sotto
adaptiveIntervalMinutes: 1  # quella cadenza; mai più lenta dell'intervallo del provider
confirmSamples: 1           # poll consecutivi che devono concordare prima di notificare
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
  discord:
    enabled: false
    webhookUrl: "${DISCORD_WEBHOOK_URL}"
  slack:
    enabled: false
    webhookUrl: "${SLACK_WEBHOOK_URL}"
```

| Chiave | Default | Note |
|---|---|---|
| `pollIntervalMinutes` | `3` | 1–1440. Il ritardo reale porta un jitter di ±10%. |
| `requestTimeoutSeconds` | `8` | Per richiesta HTTP, non per ciclo. |
| `maxRetries` | `3` | Tentativi per provider per ciclo, backoff esponenziale più jitter. |
| `failureThreshold` | `5` | Cicli falliti consecutivi prima di **un** avviso "monitoring degraded". |
| `adaptivePolling` | `true` | Mentre un provider ha un incidente aperto — o uno stato peggiore di operativo — lo interroga con `adaptiveIntervalMinutes` invece della sua cadenza. `false` lascia ogni provider sulla cadenza configurata. |
| `adaptiveIntervalMinutes` | `1` | 1–1440. Preso come **minimo** rispetto all'intervallo del provider, quindi può solo osservarlo più da vicino. Un provider che non ha mai risposto resta sulla sua cadenza: `unknown` non è un incidente. |
| `confirmSamples` | `1` | 1–10. Smorzamento dei rimbalzi: quanti poll consecutivi devono concordare su una lettura prima che il cambio venga annunciato. `1` notifica subito; `2` ignora una pagina che si contraddice per un ciclo, al costo di un poll di ritardo. |
| `locale` | `en` | `en` o `it`; qualunque valore sconosciuto ricade su `en`. |
| `services[].id` | — | Obbligatorio. Slug minuscolo: è la chiave dello stato salvato. |
| `services[].adapter` | — | Obbligatorio. `statuspage` copre ogni pagina ospitata da Atlassian; `instatus`, `betterstack`, `cachet`, `uptimekuma` e `uptimecom` coprono quelle piattaforme ospitate e self-hosted; `rss` legge qualunque feed RSS o Atom di incidenti; `html` raschia una pagina che non pubblica né l'uno né l'altro (vedi sotto); `slack`, `aws`, `gcp` e `azure` leggono i formati propri di quei provider; `http` sonda un endpoint tuo invece di una status page (vedi sotto). |
| `services[].enabled` | `true` | `false` mantiene la voce ma smette di interrogarla. |
| `services[].intervalMinutes` | — | 1–1440. La cadenza di questo provider; omesso, segue `pollIntervalMinutes`. Un ciclo gira alla cadenza più breve richiesta da qualcuno e i provider più lenti saltano i cicli in eccesso. |
| `services[].mutedUntil` | — | ISO 8601. Finché è nel futuro il provider viene interrogato e registrato come sempre ma non notifica nulla — "lo so, smetti di dirmelo, fino ad allora". Nell'edizione UI è ciò che scrive il comando **Silenzia** della dashboard. |
| `services[].options` | — | Extra specifici dell'adapter. Oggi ne accettano due: `html` (`selector`, più le liste di parole opzionali `operational` / `degraded` / `partial_outage` / `major_outage`) e `http` (vedi la sua sezione qui sotto). |

#### L'adapter `html`

Per le pagine che non pubblicano né JSON né feed. Gli si dà l'URL della pagina,
un selettore CSS per l'elemento il cui testo dice come sta il provider e — se la
pagina usa parole inconsuete — quali parole significano cosa:

```yaml
  - name: Provider su Sorry
    id: example
    adapter: html
    baseUrl: https://status.example.com/
    options:
      selector: ".status-banner"
      operational: "tutto tranquillo, nessun problema"
      major_outage: "outage, down"
```

Il selettore supporta i composti tag, `#id`, `.class` e `[attr]` /
`[attr="valore"]` con i combinatori discendente e figlio (`>`). Tutto ciò che va
oltre — una lista di selettori, una pseudo-classe, un combinatore fratello —
viene rifiutato invece di non corrispondere in silenzio.

Leggere il markup è fragile per natura, quindi i modi di rompersi sono
deliberati:

- un selettore che non corrisponde a nulla **solleva un errore**, così una
  pagina la cui struttura è cambiata fallisce come un provider non raggiungibile
  (ritentativi, poi l'avviso "monitoraggio degradato") invece di assestarsi su
  una lettura che nessuno ha chiesto;
- un testo che non corrisponde a nessuna parola configurata legge `unknown`, mai
  `operational`;
- vince la formulazione più specifica: "partial outage on the API, everything
  else operational" legge come disservizio parziale;
- non ci sono incidenti, componenti o finestre di manutenzione — una pagina che
  ha richiesto lo scraping non ha struttura da cui leggerli.

#### L'adapter `http` — sondare un endpoint tuo

Ogni altro adapter legge una pagina che un provider pubblica su se stesso.
Questo legge il servizio direttamente: fa la richiesta, e la risposta è la
lettura (roadmap 1.8).

```yaml
  - name: My API
    id: my-api
    adapter: http
    baseUrl: https://app.example.com
    options:
      path: "/health"
      expectStatus: "200-299"
      expectBody: '"db":"up"'
      slowMs: "1500"
      header.Authorization: "Bearer ${API_TOKEN}"
```

| Opzione | Default | Significato |
|---|---|---|
| `method` | `GET` | `GET` o `HEAD`. `POST` è rifiutato: il poller ritenta una lettura fallita, e un `POST` ritentato non è la stessa richiesta due volte. |
| `path` | — | Aggiunto a `baseUrl` così com'è. Le base URL sono salvate senza barra finale, quindi è così che un endpoint che ne ha bisogno la ottiene — e così che un host viene sondato su due percorsi da due servizi. |
| `expectStatus` | `200-299` | Codici singoli o intervalli inclusivi, separati da virgola (`200-299,401`). Tutto il resto è letto come disservizio, così un'API viva che ci sta rifiutando può comunque risultare sana. |
| `expectBody` | — | Testo semplice che deve comparire nella risposta. |
| `absentBody` | — | Testo semplice che **non** deve comparire: così si intercetta una pagina di errore servita con un `200`. |
| `slowMs` | — | Una risposta a questi millisecondi o oltre legge `degraded` invece di `operational`. |
| `followRedirects` | `yes` | `no` legge un `3xx` per quello che è, così un'app morta che rimanda a una pagina di login non risulta sana. |
| `tlsWarnDays` | — | Un certificato che scade entro questi giorni legge `degraded`. Spento se non impostato: `fetch` non espone nulla della connessione che ha fatto, quindi la scadenza costa un secondo handshake, chiesto solo dopo una richiesta già riuscita. |
| `header.<Nome>` | — | Un header di richiesta per opzione. Un `${VAR}` nel valore è risolto dall'ambiente al momento della richiesta; una variabile non impostata solleva un errore invece di inviare il letterale `${VAR}` e segnalare il tuo servizio giù per un `401`. |

Le letture che ne escono:

| Cos'è successo | Lettura |
|---|---|
| Stato accettato, corpo conforme, sotto `slowMs` | `operational` |
| Stato e corpo accettati, a `slowMs` o oltre | `degraded` |
| Stato e corpo accettati, certificato entro `tlsWarnDays` | `degraded` |
| Stato fuori dall'insieme, testo mancante o vietato nel corpo | `major_outage` |
| Connessione rifiutata, host non risolto, TLS respinto o timeout superato | `major_outage` |

Quattro cose da sapere prima di affidarcisi:

- un non-2xx e un host irraggiungibile sono **letture**, non letture fallite.
  Ogni altro adapter solleva un errore in quei casi perché il poller possa
  ritentare: una status page che non risponde non ci ha detto nulla, qui invece
  ci ha detto tutto.
- la lettura è una severità e nient'altro: niente incidenti, componenti o
  finestre di manutenzione. Non c'è un documento da cui leggerli, e coniare un
  incidente a ogni poll ne aprirebbe e chiuderebbe uno per ciclo. *Da quando* è
  giù continua a venire dal cambio di stato e dallo storico.
- è un solo punto di vista, questo container. Un guasto locale di DNS o di
  uscita viene letto come tutti i servizi sondati giù insieme. Il poller lo dice
  quando può: un ciclo in cui *ogni* provider è fallito o non ha risposto logga
  un warning e aggiunge "sembra un guasto dalla nostra parte" a quelle letture
  in **Diagnose** — basta una status page che risponde normalmente per
  escluderlo. Non cambia nessuna lettura e non zittisce nessun messaggio, perché
  da qui quei servizi sono davvero irraggiungibili; comprimere la raffica in un
  unico avviso di flotta richiede un evento che non riguardi un singolo provider
  (roadmap 2.7). `confirmSamples` resta l'impostazione per "un singolo sussulto
  non merita un messaggio".
- una sonda non operativa dice *perché*: **Impostazioni → riga del provider →
  Diagnose** porta la frase che la lettura non ha dove tenere — `answered HTTP
  503, outside the accepted 200-299`, `no answer from …: connect ECONNREFUSED`,
  `the TLS certificate expires in 9 day(s)`. "Giù" e "giù perché il nome non si
  risolve più" sono la stessa severità e due problemi diversi.
- sonda **qualunque cosa questo container riesca a raggiungere**, indirizzi
  privati compresi, senza alcuna allowlist. È voluto per una dashboard a
  operatore singolo in ascolto su `127.0.0.1`; è anche il motivo per cui un
  token API in sola lettura o una pagina pubblica in sola lettura (roadmap 4.15
  e 5.1) dovranno decidere chi può scrivere una definizione di servizio prima di
  esistere.
- un'opzione sbagliata (`expectStatus: 2xx`, un `${VAR}` senza nulla dietro, un
  `expectBody` su un `HEAD`) solleva un errore a ogni ciclo e si vede come
  provider che fallisce, mai come servizio che legge giù in silenzio. `node
  dist/light/check.js --probe` lo intercetta prima del poller.

Qualunque cosa non valida ferma il container all'avvio indicando motivo e percorso:
file mancante, YAML malformato, base URL sbagliato, id duplicato, lista di servizi
vuota, o un canale abilitato il cui segreto non è impostato. Un container partito con
una configurazione capita a metà sembrerebbe sano mentre in silenzio non allerta: è
l'unico modo di fallire su cui vale la pena essere rumorosi.

### 3.2 Edizione UI — impostazioni a runtime

L'edizione UI **non** monta alcun `config.yml`; uno presente su disco verrebbe
ignorato. Tutto vive in SQLite in `/app/data/isitdown.db` e si modifica da
**Settings** nella dashboard (o tramite [`/config`](api.it.md#6-api-http)):

- intervallo di polling, timeout delle richieste, numero di tentativi, smorzamento dei rimbalzi
- la lista dei servizi: aggiungi, modifica, rimuovi
- quali canali di notifica sono attivi, quale variabile d'ambiente porta ogni
  credenziale e — in sola scrittura — la credenziale stessa
- tema, lingua della dashboard, lingua delle notifiche, fuso orario

**Settings → Dati** porta anche l'unico lavoro di manutenzione che un file
SQLite richiede (roadmap 6.13): **Verifica e compatta** esegue `PRAGMA
integrity_check` e poi `VACUUM`, e riporta i byte restituiti accanto a quanto
pesa il database ora. L'ordine è voluto — un file le cui pagine sono già
sbagliate viene segnalato, non riscritto — e non cancella mai nulla: è la
pulizia giornaliera a rimuovere le righe oltre la finestra di retention, e
questo è ciò che ne restituisce le pagine.

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
| `DISCORD_WEBHOOK_URL` | entrambe | — | Webhook in entrata di Discord. Obbligatoria se il canale Discord è attivo. |
| `SLACK_WEBHOOK_URL` | entrambe | — | Webhook in entrata di Slack. Obbligatoria se il canale Slack è attivo. |
| `NTFY_TOPIC_URL` | entrambe | — | URL del topic ntfy, server incluso (`https://ntfy.sh/mio-topic`). Obbligatoria se il canale ntfy è attivo. |
| `NTFY_TOKEN` | entrambe | — | Token di accesso ntfy, opzionale. Serve solo su un server con controllo degli accessi. |
| `GOTIFY_URL` | entrambe | — | Server Gotify (`https://gotify.example.com`). Obbligatoria se il canale Gotify è attivo. |
| `GOTIFY_TOKEN` | entrambe | — | Token applicativo di Gotify. Obbligatoria insieme alla precedente. |
| `WEBHOOK_SECRET` | entrambe | — | Segreto condiviso opzionale per il webhook generico. Impostandolo ogni richiesta viene firmata (vedi [3.6](#36-canali-di-notifica)); lasciandolo vuoto le richieste partono non firmate, esattamente come prima. |
| `LOG_LEVEL` | entrambe | `info` | `debug` · `info` · `warn` · `error`. |
| `LOG_FILE` | entrambe | — | Accoda ogni riga di log anche a questo file, ruotato per dimensione. Se non è impostata, i log vanno solo su stdout. |
| `LOG_MAX_BYTES` | entrambe | `5242880` | Dimensione alla quale `LOG_FILE` ruota. |
| `LOG_MAX_FILES` | entrambe | `5` | Quante generazioni ruotate (`.1` … `.5`) sopravvivono accanto al file vivo. |
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
caricamento. Un valore si può *impostare* dalla dashboard: finisce in
`secrets.env` accanto al database — modo `0600`, nel volume dati, un
`NAME=value` per riga — e nell'ambiente del server, quindi il canale funziona
dalla richiesta successiva senza riavviare nulla. Conseguenze da conoscere:

- Settings mostra il nome della variabile, se al momento si risolve e un campo
  valore in sola scrittura. Il campo si presenta sempre vuoto e `Cancella`
  dimentica un valore salvato; nessuno lo rilegge.
- `PATCH /config/channels/:id` **rifiuta** ancora una richiesta che porti un
  segreto letterale: i valori passano da `PUT /config/channels/:id/secrets`, e al
  database non viene mai offerto nulla.
- Un valore salvato prevale sulla stessa variabile che arriva da `env_file` — è
  l'istruzione più recente ed esplicita — e ogni sostituzione viene loggata
  all'avvio.
- `DELETE /config/channels/:id/secrets/:field` dimentica solo ciò che il file
  stesso contiene; per una variabile fornita dal container risponde `409` invece
  di fingere. Dimenticare una voce che aveva sostituito un valore di `env_file`
  fa tornare in vigore quel valore, invece di lasciare il canale senza nulla.
- Nessuna risposta API, nodo del DOM, riga di log o messaggio d'errore contiene un
  segreto risolto. I test lo verificano.
- Un canale attivo nel database la cui variabile non è impostata viene saltato per
  quel ciclo con un warning, invece di far crashare la dashboard: a differenza di
  Light, qui esiste una UI in cui un operatore può vederlo e sistemarlo.

La dashboard accetta quindi una credenziale, come disegnava il prototipo di
design, ma in un solo verso: dentro.

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

L'edizione UI include anche un **catalogo** di provider noti (roadmap 5.11): il
dialog di aggiunta si apre su un menu di nomi, e una scelta riempie adapter,
base URL e id. Ogni voce in `src/adapters/catalog.ts` è stata confermata
eseguendo la detection sulla pagina, quindi ciò che il menu offre è ciò che un
adapter legge davvero. I provider la cui status page rifiuta una lettura
automatica (Stripe, GitLab, Zendesk, Okta) sono volutamente assenti invece che
elencati e rotti — per quelli, e per tutto ciò che la lista non ha, si incolla
l'URL e si lascia che la detection (`POST /config/services/detect`) nomini l'adapter. Una voce già monitorata
resta nel menu, segnata, invece di sparire. Servito come `GET /config/catalog`.

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
`scheduled_maintenances` viene letto a parte: una finestra dichiarata non è una
severità, silenzia gli avvisi del provider mentre è in corso.

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

#### L'adapter RSS / Atom

Una lunga coda di status page pubblica un feed e nient'altro. `adapter: rss` li
legge tutti, senza una riga di codice per provider:

```yaml
  - id: example
    name: Example
    adapter: rss
    baseUrl: https://status.example.com/history.rss
```

`baseUrl` **è l'URL del feed**: questo adapter non ci accoda niente.

Un feed annuncia incidenti, non dichiara mai uno stato complessivo, quindi lo
stato viene dedotto — e la deduzione è volutamente pessimista: una voce che non
si riesce a datare o a classificare vale come problema, mai come rientro.

| Voce del feed | Lettura |
|---|---|
| Pubblicata nelle ultime 24 ore, senza parola di chiusura | Incidente aperto |
| Dice `resolved`, `completed`, `restored`, `closed` | Chiusa, qualunque altra cosa dica |
| Più vecchia di 24 ore | Non più attuale |
| Senza data | Considerata attuale |
| Senza `guid`, `id` o `link` | Scartata: manca una chiave stabile per l'incidente |

La severità viene dalle parole del provider: `partial` → disservizio parziale;
`outage`, `down`, `offline`, `unavailable`, `unreachable` → disservizio grave;
qualunque altra cosa il provider abbia ritenuto di annunciare → degradato.

Due conseguenze da sapere prima di affidarcisi: l'adapter non elenca componenti,
perché un feed non ne ha; e la sua cronologia incidenti non dichiara mai di
essere completa, perché un feed è una finestra su una storia, non la storia.

#### L'adapter Slack

Slack pubblica una sua piccola API JSON invece di stare su Statuspage, quindi ha
un adapter dedicato:

```yaml
  - id: slack
    name: Slack
    adapter: slack
    baseUrl: https://slack-status.com
```

`baseUrl` è l'host: l'adapter accoda `/api/v2.0.0/current` per quello che è
aperto adesso e `/api/v2.0.0/history` per la cronologia. (`https://status.slack.com`
redirige lì e funziona ugualmente.)

Il payload non porta nessun campo di severità — un incidente è un titolo, una
parola di stato e l'elenco dei servizi coinvolti — quindi la severità viene
dedotta dalle parole di Slack, esattamente come fa l'adapter dei feed. Cosa ne
esce:

| Payload | Lettura |
|---|---|
| `active_incidents` vuoto | Operativo |
| Una voce con `type: notice` | Elencata come incidente, ma da sola non muove lo stato del provider |
| `status: ok` in testa con una voce ancora aperta | Problema: l'elenco degli incidenti fa da indicatore, non la parola |
| Una voce senza `id` | Scartata: manca una chiave stabile per l'incidente |

Slack indica i servizi coinvolti da un incidente ma non pubblica lo stato dei
singoli servizi, quindi l'adapter non elenca componenti; e non espone dati di
manutenzione programmata, quindi una voce che ne annuncia una resta un incidente
invece di diventare una finestra che silenzierebbe il provider finché resta lì.

#### AWS, Google Cloud e Azure

I tre hyperscaler non pubblicano nulla in formato Statuspage e ognuno è strano a
modo suo, quindi ognuno ha il proprio adapter:

```yaml
  - id: aws
    name: AWS
    adapter: aws
    baseUrl: https://health.aws.amazon.com
    options:
      region: eu-west-1        # opzionale; omesso, guarda ogni regione

  - id: gcp
    name: Google Cloud
    adapter: gcp
    baseUrl: https://status.cloud.google.com

  - id: azure
    name: Azure
    adapter: azure
    baseUrl: https://azure.status.microsoft
    options:
      locale: en-us            # opzionale; il feed è pubblicato per locale
```

**AWS** — l'adapter aggiunge `/public/currentevents`, il documento degli eventi
aperti in questo momento. Ne seguono due cose: non c'è cronologia da
ricostruire, perché un evento risolto sparisce dal documento invece di essere
marcato chiuso; e ogni evento riguarda una sola regione, quindi
`options.region` restringe alla tua. Un evento globale — uno che il feed
pubblica senza regione — è sempre riportato: restringere non deve nascondere
proprio la classe di evento che colpisce tutto. La severità è il codice
numerico di AWS, non un'ipotesi sulle parole:

| Codice | Lettura |
|---|---|
| `0` | Chiuso: sparisce invece di tenere rossa una regione già rientrata |
| `1` | Informativo: elencato come incidente, non muove lo stato |
| `2` | Degradato |
| `3` | Outage grave |
| qualunque altro | Outage grave — mai declassato in silenzio |

Il documento è servito in UTF-16, che il `text()` di `fetch` decodifica come
UTF-8 rovinandolo; IsItDown decodifica secondo il charset dichiarato dalla
risposta.

**Google Cloud** — l'adapter aggiunge `/incidents.json`, una lista piatta che è
insieme lo stato attuale e la cronologia: un incidente senza `end` è aperto e lo
stato del provider è la somma di quelli aperti. La severità viene da
`status_impact` (`SERVICE_INFORMATION` → un annuncio che non muove lo stato,
`SERVICE_DISRUPTION` → outage parziale, `SERVICE_OUTAGE` → outage grave,
qualunque valore sconosciuto → outage grave) e non dalla parola `severity`
accanto, che lo contraddice.

**Azure** — la metà leggibile da una macchina di `azure.status.microsoft` è un
feed RSS, quindi questo adapter legge il feed su `/<locale>/status/feed/` e
aggiunge le due cose che l'adapter generico sbaglia su Azure: sa che
"mitigated" chiude un incidente e sa che il feed è *vuoto* quando Azure sta
bene, quindi un feed vuoto è operativo e non sconosciuto. La sua cronologia
arriva solo fin dove arriva il feed, che per un provider che pubblica solo le
comunicazioni aperte non è lontano.

#### Instatus e Better Stack

Le due alternative a Statuspage più diffuse, ognuna con un proprio endpoint
JSON pubblico:

```yaml
  - id: gcore
    name: Gcore
    adapter: instatus
    baseUrl: https://status.gcore.com

  - id: betterstack
    name: Better Stack
    adapter: betterstack
    baseUrl: https://status.betterstack.com
```

**Instatus** — l'adapter aggiunge `/summary.json` per la parola della pagina più
i suoi incidenti aperti e le manutenzioni dichiarate, e `/v3/components.json`
per l'elenco dei componenti. La seconda richiesta parte solo se il provider ha
componenti selezionati: un provider per cui nessuno ha scelto componenti non
deve pagare due richieste a ciclo per un elenco che nessuno legge.

| Payload | Lettura |
|---|---|
| `page.status: UP`, niente aperto | Operativo |
| L'`impact` di un incidente | `DEGRADEDPERFORMANCE` → degradato, `PARTIALOUTAGE` → disservizio parziale, `MAJOROUTAGE` → disservizio grave |
| `page.status: HASISSUES` senza nulla in elenco | Degradato: una pagina che non ha ancora pubblicato l'incidente non deve leggersi come tranquilla |
| `page.status: UNDERMAINTENANCE` | Sconosciuto: si astiene invece di dichiararsi su |
| Una parola di impact che non conosciamo | Disservizio grave; mai declassato in silenzio |
| `activeMaintenances[].duration` | Minuti, quindi la fine della finestra si deriva da lì — Instatus non pubblica un timestamp di fine |

`summary.json` non attribuisce un incidente ai componenti che colpisce, quindi
`scopeToComponents` restringe i componenti riportati e lo stato ricavato da
loro, ma non scarta mai un incidente. Instatus non pubblica nessuno storico
incidenti in JSON, quindi non c'è nulla da cui fare backfill: se ti serve la
cronologia, il feed RSS della pagina si può aggiungere come secondo provider
sull'adapter `rss`.

**Better Stack** — l'adapter aggiunge `/index.json`, e quel singolo documento è
tutta la pagina: lo stato aggregato, ogni risorsa (la loro parola per
"componente") col proprio stato, ogni report — il loro strumento sia per gli
incidenti sia per le manutenzioni programmate — e ogni aggiornamento pubblicato
su quei report. Così componenti, scoping per componente *inclusa*
l'attribuzione degli incidenti e storico incidenti arrivano da una sola lettura.

| Payload | Lettura |
|---|---|
| `aggregate_state` | `operational`, `degraded` → degradato, `downtime` → disservizio grave |
| `maintenance` o `not_monitored` | Sconosciuto: si astiene invece di leggersi come un ripristino |
| Un report `report_type: manual` non in stato `resolved` | Un incidente aperto |
| Un report `report_type: maintenance` | Una finestra di manutenzione, non un incidente |
| L'`ends_at` di un report | Spesso null anche a incidente risolto — Better Stack lo chiude per stato — quindi l'aggiornamento più recente è l'ora di chiusura |

Sorry™, la terza pagina di questa famiglia, non pubblica alcun JSON senza
autenticazione: le pagine pubbliche sono HTML e la sua API richiede una chiave,
quindi serve l'adapter generico di scraping HTML (roadmap 1.6) e non un parser
tutto suo.

#### Cachet, Uptime Kuma e Uptime.com

Altre tre forme JSON piccole, e le prime due sono quelle che il pubblico di
questo progetto si ospita da sé — una flotta può includere la status page del
vicino:

```yaml
  - id: neighbour
    name: Il Cachet del vicino
    adapter: cachet
    baseUrl: https://status.neighbour.example

  - id: homelab
    name: Homelab
    adapter: uptimekuma
    baseUrl: https://uptime.example.com/status/demo

  - id: uptimecom
    name: Uptime.com
    adapter: uptimecom
    baseUrl: https://status.uptime.com/statuspage/uptime-status
```

**Cachet** — tre letture per ciclo, perché Cachet pubblica le tre metà di una
status page in tre documenti e nessuno sostituisce gli altri:
`/api/v1/components`, `/api/v1/incidents` e `/api/v1/schedules`. Si rivalidano
con l'`ETag` come ogni altra lettura qui, quindi un ciclo tranquillo sono tre
`304`. Cachet non ha una parola aggregata — `/api/v1/status` risponde un
`success`/`info`/`danger` a tre vie che non distingue un disservizio parziale da
uno grave — quindi la lettura si ripiega dai componenti, che è anche da dove si
ripiega un provider ristretto alla selezione.

| Payload | Lettura |
|---|---|
| Lo `status` di un componente | `1` operativo, `2` → degradato, `3` → disservizio parziale, `4` → disservizio grave |
| Un numero che non conosciamo | Disservizio grave; mai declassato in silenzio |
| `enabled: false` | Fuori dalla lettura: un componente disabilitato non è sulla pagina |
| L'`is_resolved` di un incidente | Aperto finché non è vero; un Cachet troppo vecchio per pubblicarlo si chiude su un aggiornamento `Fixed` |
| `component_id: 0` | Un incidente di pagina, che raggiunge anche un provider ristretto |
| Uno schedule | Una finestra di manutenzione; `status: 2` (completata) viene scartata |
| Un timestamp | Scritto senza alcun fuso, quindi letto come UTC — che è quello su cui gira un'installazione in container |

Ogni lista viene chiesta al tetto dell'API di 100 righe: un'istanza con più di
100 componenti viene letta come i suoi primi cento, invece di percorrere la
paginazione a ogni ciclo. Il selettore dei componenti risolve i nomi dei gruppi
da `/api/v1/components/groups`, che solo la dashboard chiede.

**Uptime Kuma** — una sonda più che una pagina scritta da qualcuno, quindi non
pubblica nemmeno lui una parola aggregata. Due letture per ciclo, entrambe
necessarie: il documento della status page nomina i monitor e non dice mai come
stanno, quello degli heartbeat dice come stanno e non li nomina mai. Indica l'URL
della pagina come lo vedi nel browser (`…/status/<slug>`) e lo slug viene letto da
lì; un host nudo legge la pagina `default` di Kuma, e `options.slug` ha comunque
la precedenza.

| Payload | Lettura |
|---|---|
| L'heartbeat più recente di un monitor | `1` operativo, `0` → disservizio grave, `2` (in ritentativo) → degradato, `3` (manutenzione) → sconosciuto |
| Tutti i monitor su | Operativo |
| Alcuni su, alcuni giù | Disservizio parziale — la regola dell'intestazione di Kuma, non un peggiore-di-tutti: un monitor giù su dieci non si legge come un disservizio grave |
| Tutti i monitor giù | Disservizio grave |
| Nessun heartbeat, o tutti astenuti | Sconosciuto |
| L'incidente in evidenza (`incident`, o `incidents` su 2.x) | Un incidente aperto con la parola `style` di Kuma |
| `maintenanceList[]` | Una finestra, collocata sull'orologio con il `timezoneOffset` della voce stessa; non dice quali monitor copre |

Non c'è cronologia degli incidenti da recuperare: una pagina Kuma pubblica gli
heartbeat e l'unico avviso in evidenza, e nulla che equivalga a un incidente
chiuso con un inizio e una fine.

**Uptime.com** — la pagina è renderizzata dal server e il payload da cui è
renderizzata viene servito in JSON accanto: `<pagina>/ajax` per lo stato attuale,
`<pagina>/history` per gli incidenti chiusi. Entrambi rispondono dentro una busta
`{ error, fields, data }`. Il base URL è la status page stessa e non l'host,
perché un account può pubblicarne diverse, una per `/statuspage/<slug>`.

| Payload | Lettura |
|---|---|
| Lo `status` di un componente | `operational`, `degraded-performance` → degradato, `partial-outage`, `major-outage`; punteggiatura e maiuscole vengono ignorate |
| `under-maintenance` | Sconosciuto: si astiene invece di dirsi su |
| Un gruppo | Letto attraverso i suoi sottocomponenti, mai due volte: lo stato di un gruppo è il riassunto esatto di quelli |
| `global_is_operational: false` | Alza a degradata una lettura altrimenti operativa — una pagina può portare un incidente che non ha mosso alcun componente — ma non abbassa mai |
| `incident_type: INCIDENT` | Un incidente aperto |
| `incident_type: SCHEDULED_MAINTENANCE`, o `upcoming_maintenance[]` | Una finestra di manutenzione, non un incidente |
| Lo stato di un incidente | `latest_update_incident_state`, oppure lo stato dell'aggiornamento più recente — i due endpoint riempiono campi diversi |

Freshstatus, la quarta pagina considerata per questa famiglia, non è leggibile
senza credenziali: le sue pagine si renderizzano lato client e la sua API
pubblica risponde `403` a tutto ciò che non sia il suo stesso front end, quindi
serve l'adapter di scraping HTML e non un parser tutto suo.

Per un provider che non sta su nessuno di questi, aggiungi un adapter sotto
`src/adapters/`.

#### Richieste condizionali

Ogni adapter legge attraverso un unico helper HTTP che ricorda l'`ETag` (o il
`Last-Modified`) inviato dal provider e lo ripropone al ciclo successivo. Una
pagina che non è cambiata risponde `304` senza corpo e viene riusata quella in
cache: la maggioranza dei cicli. Costa meno al provider ed è la differenza tra
essere limitati per rate e non esserlo, su chi ha una soglia stretta. Un `304`
a una richiesta senza validatore, una rivalidazione fallita o una pagina che
smette di inviare validatori azzerano la voce in cache invece di inchiodare una
lettura vecchia.

### 3.6 Canali di notifica

| Canale | Chiave di configurazione | Variabili richieste |
|---|---|---|
| Telegram Bot API | `telegram` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Webhook generico | `webhook` | `WEBHOOK_URL` |
| Discord | `discord` | `DISCORD_WEBHOOK_URL` |
| Slack | `slack` | `SLACK_WEBHOOK_URL` |
| ntfy | `ntfy` | `NTFY_TOPIC_URL` (`NTFY_TOKEN` opzionale) |
| Gotify | `gotify` | `GOTIFY_URL`, `GOTIFY_TOKEN` |
| Email (SMTP) | `email` | `SMTP_HOST`, `SMTP_FROM`, `SMTP_TO` (`SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_ALLOW_INSECURE_AUTH`, `SMTP_ALLOW_SELF_SIGNED` opzionali) |
| Desktop (Web Push) | `webpush` | nessuna |

Il push desktop non richiede alcuna configurazione: il server genera la propria
coppia di chiavi VAPID la prima volta che il canale viene usato e la conserva nel
database, quindi abilitare il canale e premere "abilita su questo browser" nelle
Impostazioni è tutta la procedura. Ogni browser abilitato compare nell'elenco
dispositivi della card e può essere rimosso da lì.

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

**Firma.** Impostando `WEBHOOK_SECRET` (o `webhook.secret` in `config.yml`) ogni
richiesta porta due header in più:

```
X-IsItDown-Timestamp: 2026-08-19T14:32:07.000Z
X-IsItDown-Signature: sha256=<hex>
```

La firma è un HMAC-SHA256 su `` `${timestamp}.${body}` `` con il segreto come
chiave, calcolato sui byte esatti che sono stati inviati. Per verificarla,
ricostruisci la stessa stringa dal body grezzo — non da un parse riserializzato —
e confronta a tempo costante; il timestamp è dentro il materiale firmato, così un
ricevitore può anche rifiutare una richiesta troppo vecchia per essere autentica.
Senza segreto non viene aggiunto nulla, quindi un ricevitore esistente continua a
funzionare intatto.

Discord e Slack sono entrambi webhook in entrata: creane uno nel server o nel
workspace di destinazione, metti l'URL in `DISCORD_WEBHOOK_URL` o
`SLACK_WEBHOOK_URL` e attiva il canale. Entrambi riportano le stesse parole che
manda ogni altro canale, disposte in modo nativo: Discord come un embed il cui
titolo porta la severità e rimanda alla status page del provider, colorato per
severità; Slack come una sezione Block Kit più un pulsante "Apri la pagina di
stato", con l'intestazione ripetuta come testo di anteprima della notifica.
Nessuno dei due URL finisce mai in un log o nella dashboard: un invio rifiutato
riporta lo stato HTTP e la ragione del servizio stesso.

**ntfy e Gotify** sono la coppia del push self-hosted (roadmap 3.4). ntfy è una
sola POST: l'URL del topic porta con sé il server, quindi
`https://ntfy.sh/isitdown` e `https://ntfy.example.com/isitdown` sono la stessa
impostazione; l'intestazione diventa il titolo della notifica, il dettaglio il
suo corpo, e toccandola si apre la status page del provider. `NTFY_TOKEN` serve
solo su un server con controllo degli accessi — un topic pubblico funziona senza.
Gotify vuole il suo server più un token applicativo, inviato a `/message` con il
token in `X-Gotify-Key` e non nell'URL, perché un URL finisce nei log.

Entrambi mappano la gravità sulla scala di priorità del canale, così ciò che può
suonare di notte è una proprietà della lettura e non una regola da ricostruire su
ogni telefono: sulla scala 1–5 di ntfy un major outage è `5` e un rientro è `2`;
su quella 0–10 di Gotify, `9` e `3`. Nessuna delle due credenziali finisce nei
log o nella dashboard, e un invio rifiutato riporta lo stato HTTP con la
motivazione del server stesso.

**Email** è una submission SMTP, ed è scritta qui invece che presa da una
libreria (roadmap 3.3): a una notifica serve una sola conversazione di
submission — saluto, `EHLO`, `STARTTLS`, `AUTH`, envelope, `DATA` — ed è
`src/notifiers/smtp.ts`, così il progetto ha ancora le tre dipendenze a runtime
che dichiara. Quello che una libreria di posta ci metterebbe sopra — parsing
degli indirizzi, allegati, pool di connessioni, una dozzina di trasporti — a un
avviso di stato non serve.

L'oggetto è l'intestazione che ogni altro canale mette per prima (`🔴 GitHub —
MAJOR OUTAGE`), così una schermata di blocco mostra la stessa frase che
mostrerebbe Telegram; il corpo è il dettaglio più la status page del provider,
visto che un client di posta non ha dove appendere un link. `SMTP_TO` accetta un
indirizzo o più d'uno separati da virgole, e parte un solo messaggio con un
destinatario di envelope per ciascuno.

I default sono quelli che un server di submission si aspetta: porta 587 con
`STARTTLS` ogni volta che il server lo offre, e porta 465 trattata come TLS
implicito che `SMTP_SECURE` lo dica o no. Due impostazioni esistono per il
server sulla tua stessa macchina, ed entrambe sono spente se non impostate:
`SMTP_ALLOW_INSECURE_AUTH` è ciò che serve per mandare credenziali su una
connessione mai cifrata — senza, l'invio fallisce invece di mettere una password
su un socket in chiaro — e `SMTP_ALLOW_SELF_SIGNED` accetta un certificato che
nessuna CA pubblica ha firmato. Un relay che si fida di questa rete non vuole
credenziali affatto, ed è per questo che entrambe sono opzionali. Un messaggio
rifiutato riporta la risposta del server (`550 5.7.1 relay denied`) nel registro
delle consegne.

### 3.7 Instradamento delle notifiche

Una tabella ordinata di regole decide quali canali abilitati vengono avvisati
di un dato cambiamento. Ogni regola ha quattro parti:

```yaml
routing:
  - provider: "*"            # un id di servizio, `group:<slug>` (§3.10), `<id>#<componente>`, o "*"
    classes: [status, incident]  # una o più tra: status, incident, maintenance, monitoring
    minSeverity: major_outage  # any | degraded | partial_outage | major_outage
    channels: [telegram]       # id dei canali, o "*" per ogni canale abilitato; [] silenzia
```

Le regole vengono valutate dall'alto in basso e **vince la prima che
corrisponde** — le regole successive non vengono più consultate per quel
cambiamento, quindi una regola specifica per un provider, messa sopra una
regola generica, può silenziarlo o reindirizzarlo. Una regola corrisponde
quando il provider, la classe dell'evento e la severità del cambiamento
soddisfano tutti e tre quanto richiesto; un `channels: []` vuoto è un modo
valido e deliberato per silenziare una corrispondenza, non una svista. La
severità viene giudicata sul *peggiore* tra il punto di partenza e quello di
arrivo del cambiamento — un ripristino da un'interruzione grave porta ancora
la soglia dell'interruzione, quindi una regola che filtra su `major_outage`
scatta comunque per il rientro, invece di lasciarlo passare senza
instradamento. Un'installazione senza alcuna regola si comporta esattamente
come se esistesse una regola generica: ogni classe, qualunque severità, ogni
canale abilitato — il comportamento che entrambe le edizioni avevano prima
dell'esistenza dell'instradamento, così l'aggiornamento non diventa mai muto
per caso.

Una regola può anche nominare **un componente di un provider**, come
`<id>#<componente>` — `github#8l4ygp009s5s`. La transizione di un componente
porta già la severità del componente e non quella del provider, quindi bastava
questo per instradarla in modo indipendente: metti `github#api` sopra `github` e
quel componente va su un telefono mentre tutto il resto della pagina va su
Slack, oppure dagli `channels: []` e silenzia un componente rumoroso senza
ammutolire il provider. Un target di componente corrisponde solo alle
transizioni di quel componente, quindi un cambio di stato del provider non lo
incontra mai. L'id del componente è quello del provider — lo stesso che salva il
selettore dei componenti — e rimuovere un provider elimina anche le regole dei
suoi componenti.

L'edizione Light configura la tabella come l'elenco `routing` in
`config.yml`, mostrato sopra; l'edizione UI la modifica da **Impostazioni**,
dove la colonna del provider elenca sotto ciascuno i componenti selezionati e
l'editor delle regole di instradamento offre anche una prova a secco
(dry run): scegli un provider (e, dove ce n'è uno selezionato, un componente)
più un evento campione e ti dice quale regola vincerebbe e quali non sono mai
state raggiunte, valutate contro le regole che hai effettivamente salvato, non
un insieme ipotetico.

### 3.8 Politica di consegna — ore di silenzio, riepiloghi, limiti

Le regole di instradamento decidono *chi* viene informato di un cambiamento.
Altri quattro controlli decidono *quanto* di quel cambiamento esce davvero, e in
quanti messaggi. Tutti e quattro sono disattivati per default, così
un'installazione che non ne configura nessuno si comporta esattamente come prima
che esistessero.

```yaml
delivery:
  quietHours:
    enabled: true
    start: "23:00"          # inclusa
    end: "07:00"            # esclusa; la finestra può scavalcare la mezzanotte
    timeZone: "Europe/Rome" # un nome IANA, o "auto" per il fuso del container
    minSeverity: major_outage
  digest:
    enabled: true
    windowMinutes: 15
    immediateFloor: major_outage
  cap:
    enabled: true
    maxPerHour: 6
  updateInPlace: true
```

**Le ore di silenzio** sono un *ingresso* dell'instradamento, non un filtro
aggiunto dopo le regole: dentro la finestra escono solo i cambiamenti che
superano `minSeverity`, e la prova a secco dell'edizione UI dice quando è stata
l'ora — e non una regola — a decidere. Un cambiamento trattenuto viene scartato,
non rinviato: rinviare è il compito del riepilogo. La finestra si legge in
`timeZone` e in caso di valore inutilizzabile (un orario malformato, un fuso
sconosciuto, estremi uguali) fallisce *in apertura*, perché l'unico esito da
escludere qui è una notte di silenzio causata da un errore di battitura.

**La modalità riepilogo** raccoglie tutto ciò che sta *sotto*
`immediateFloor` e lo invia come un unico messaggio per finestra; ciò che è pari
o superiore alla soglia parte comunque nell'istante in cui accade, così la
finestra ritarda soltanto quello che hai dichiarato non urgente. Il batch viene
svuotato in base all'orologio e non all'arrivo del prossimo cambiamento: è per
questo che anche una finestra tranquilla finisce con un messaggio. Due limiti
dichiarati: un canale disattivato mentre una finestra è aperta perde il proprio
batch (con una riga nel log), e un batch ancora in raccolta quando il processo si
ferma viene perso invece di arrivare un'ora dopo.

**Il limite** è un tetto per provider per ora scorrevole, contato per
*cambiamento* e non per canale — chi legge è una persona sola, qualunque sia il
numero di canali attivi. Ciò che il limite trattiene viene contato, e il primo
messaggio che passa porta una riga "altri avvisi sono stati soppressi", così un
limite non può essere confuso con un canale che ha smesso di funzionare. Un
cambiamento finito nel riepilogo non viene volutamente addebitato al limite: un
batch è un messaggio.

**`updateInPlace`** fa di un incidente un solo messaggio, riscritto man mano che
l'incidente evolve, sui canali che sanno modificare ciò che hanno inviato:
Telegram (`editMessageText`) e Discord (l'id del messaggio del webhook). L'id è
ricordato per canale e per incidente, il messaggio che chiude l'incidente lo
rilascia, e una modifica rifiutata dal canale (troppo vecchia, cancellata a
mano) ripiega su un messaggio nuovo invece di perdere l'aggiornamento. Il
webhook entrante di Slack non sa modificare, quindi continua a ricevere un
messaggio per aggiornamento.

L'edizione Light configura tutti e quattro con il blocco `delivery` sopra;
l'edizione UI li modifica da **Impostazioni → Consegna**, dove ogni riga si
applica da sé e senza riavvio.

### 3.9 Validare un `config.yml` — il comando `check`

Validare un file avviando il container e leggendone i log racconta solo il primo
problema, e costa un container per scoprirlo. `check` legge lo stesso file con lo
stesso loader e stampa *tutti* i problemi, poi esce con codice diverso da zero:

```bash
node dist/light/check.js ./config.yml
#   ./config.yml is valid — 4 services (3 enabled), channels: telegram, file only, no provider read

docker exec isitdown-light node dist/light/check.js; echo "exit=$?"
#   /app/config/config.yml is valid — 4 services (4 enabled), channels: telegram, ...
#   exit=0
```

Senza percorso legge `$CONFIG_PATH`, come fa il container. Da un checkout dei
sorgenti, `npm run check:config -- ./config.yml` esegue lo stesso comando senza
build.

Cosa segnala, tutto in una passata:

| Segnalazione | Livello |
|---|---|
| File assente, illeggibile o YAML non valido | error |
| Tutto ciò che lo schema rifiuta (chiave mancante, intervallo fuori scala, base url malformata) | error |
| Un riferimento `${VAR}` senza valore nell'ambiente — **ognuno**, per nome | error |
| Lo stesso `id` di servizio dichiarato due volte | error |
| Un canale attivo con un'impostazione obbligatoria vuota | error |
| Una regola di instradamento che nomina un provider o un canale che il file non definisce | error |
| Un servizio che nomina un `adapter` inesistente, con l'elenco di quelli noti | error |
| Un servizio `http` le cui opzioni di sonda non sono leggibili (`expectStatus` sbagliato, un `${VAR}` senza nulla dietro, un `expectBody` su un `HEAD`) — offline, quindi intercettato anche senza `--probe` | error |
| Con `--probe`: una base url che nessun adapter riconosce. I servizi `http` qui vengono saltati: il bersaglio di una sonda non è una status page e non deve sembrarlo | error |
| Con `--probe`: una pagina che sembra un adapter diverso da quello dichiarato | warning |

I warning vengono stampati e non fanno fallire il controllo: l'adapter `html` è
una scelta difendibile per una pagina che pubblica anche un riepilogo Statuspage.

`--probe` legge la pagina di ogni provider attivo (quelli disattivati vengono
lasciati stare, perché il file lo dice già) e chiede quale adapter la riconosce,
con la stessa detection usata dal form "aggiungi provider" dell'edizione UI. È
disattivato per default: un controllo che va in rete non è qualcosa su cui una CI
possa contare, e ogni altra segnalazione qui sopra si risponde dal solo file.

Codici di uscita: `0` valido, `1` almeno un errore, `2` comando invocato male
(opzione sconosciuta, due percorsi). Così è CI-abile per chi gestisce l'istanza e
non solo per noi:

```yaml
- run: docker run --rm -v ./config.yml:/app/config/config.yml:ro \
    ghcr.io/devmanfre/isitdown:light-latest node dist/light/check.js
```

### 3.10 Gruppi di provider — "il mio stack"

Una flotta piatta risponde a "GitHub sta bene" e mai a "il mio percorso di deploy
sta bene", che è la domanda che un operatore ha davvero: quattro provider che
singolarmente non gli interessano, e una risposta che gli interessa. Un gruppo è
uno slug che il provider porta (roadmap 2.6) — in `config.yml`:

```yaml
services:
  - name: GitHub
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com
    group: deploy-path
  - name: Cloudflare
    id: cloudflare
    adapter: statuspage
    baseUrl: https://www.cloudflarestatus.com
    group: deploy-path
```

— e, nell'edizione UI, il campo **Gruppo** su un servizio, con i gruppi già
esistenti proposti mentre si scrive.

Ne derivano due cose:

- **Uno stato combinato.** La Panoramica guadagna una banda "Il mio stack", una
  tile per gruppo, nello stato del gruppo: vince il membro peggiore, e la tile
  nomina i membri che stanno dietro a quello stato. `unknown` non è una severità
  — la stessa regola che diff engine e soglie di instradamento seguono già —
  quindi un provider silenzioso non può tenere uno stack sano su `unknown`, e
  solo un gruppo di cui non si legge nulla si presenta così. Un provider
  disattivato esce dal suo gruppo: nessuno lo interroga, quindi non può rendere
  malato uno stack. Il composito è derivato dal server (il campo `groups` di
  `/status`), mai ricalcolato nel browser, così la tile e le righe sotto non
  possono contraddirsi.
- **Una sola regola di instradamento per tutto lo stack.** Il campo `provider` di
  una regola accetta `group:deploy-path`, che copre ogni membro — e continua a
  coprirli quando lo stack guadagna un quinto provider, cosa che quattro id
  scritti a mano non farebbero. La tabella di instradamento della dashboard
  propone i gruppi sopra i singoli provider, e la prova a vuoto li valuta con il
  gruppo del provider scelto.
