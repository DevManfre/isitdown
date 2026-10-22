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
correlationThreshold: 0     # provider che devono peggiorare insieme perché un unico avviso di guasto condiviso li sostituisca; 0 è spento
correlationWindowMinutes: 10 # quanto è larga quella finestra
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
| `correlationThreshold` | `0` | 0–100. Rilevamento dei guasti correlati (roadmap 2.7): quanti provider devono peggiorare entro `correlationWindowMinutes` perché il ciclo mandi un unico avviso "sembra un guasto condiviso" invece di uno per provider. `0` e `1` sono spento, che è il default — è l'unica impostazione qui che *sostituisce* avvisi. |
| `correlationWindowMinutes` | `10` | 1–1440. Quanto è larga quella finestra. Più larga intercetta un guasto condiviso che attraversa lentamente le status page, e rischia di unire due giornate storte non collegate. |
| `locale` | `en` | `en` o `it`; qualunque valore sconosciuto ricade su `en`. |
| `services[].id` | — | Obbligatorio. Slug minuscolo: è la chiave dello stato salvato. |
| `services[].adapter` | — | Obbligatorio. `statuspage` copre ogni pagina ospitata da Atlassian; `instatus`, `betterstack`, `cachet`, `uptimekuma` e `uptimecom` coprono quelle piattaforme ospitate e self-hosted; `rss` legge qualunque feed RSS o Atom di incidenti; `imap` legge gli avvisi di un vendor da una casella di posta (vedi sotto); `html` raschia una pagina che non pubblica né l'uno né l'altro e `watchdog` segnala qualunque cambiamento nel testo di una pagina (vedi sotto); `slack`, `aws`, `gcp` e `azure` leggono i formati propri di quei provider; `http` sonda un endpoint tuo invece di una status page, e `sequence` concatena due o tre richieste per un'API dietro un login, `tcp` e `dns` sondano una porta e un nome che non parlano HTTP affatto (vedi sotto). |
| `services[].enabled` | `true` | `false` mantiene la voce ma smette di interrogarla. |
| `services[].intervalMinutes` | — | 1–1440. La cadenza di questo provider; omesso, segue `pollIntervalMinutes`. Un ciclo gira alla cadenza più breve richiesta da qualcuno e i provider più lenti saltano i cicli in eccesso. |
| `services[].intervalSeconds` | — | 10–3600, solo sonde (`http`, `sequence`, `tcp`, `dns`). La stessa cadenza in secondi, per un endpoint che può restare giù meno di un minuto; una pagina di stato resta sul pavimento del minuto e viene rifiutata al caricamento. Mai insieme a `intervalMinutes`. |
| `services[].crossChecks` | — | Solo su una sonda (`http`, `sequence`, `tcp`, `dns`) o su una lettura di posta (`imap`): l'id del provider di cui questa sonda è un secondo parere — controllo incrociato dei guasti silenziosi (roadmap 1.10). Quando la sonda non raggiunge il servizio e la status page di quel provider dichiara ancora operativo senza incidenti aperti, il disaccordo è esso stesso un avviso. Si può restringere a un singolo componente con la stessa forma `provider#componente` con cui una regola di routing indica il bersaglio (roadmap 2.9); la metà componente serve solo a precisare contro cosa la scheda di fiducia (roadmap 8.1) confronta la sonda, dato che il controllo dei guasti silenziosi riguarda una pagina che dichiara che non c'è proprio nulla che non va. |
| `services[].authority` | dall'adapter | Quale fonte fa fede per questo provider — `declared` (la sua status page) oppure `observed` (la nostra misura), roadmap 9.1. Ometterlo è il caso normale e non è un valore mancante: una sonda (`http`, `sequence`, `tcp`, `dns`) legge `observed` perché *è* la misura, e tutto ciò che legge la pagina di qualcun altro legge `declared`. Va impostato solo per non essere d'accordo con quel default — una status page di cui hai imparato a diffidare, o una sonda che non vuoi sia trattata come il riferimento. Decide cosa la dashboard stampa accanto all'adapter e come è formulato un avviso di disservizio silenzioso, non quali campioni sostengono una percentuale. Vedi [7.7](how-it-works.it.md#77-quale-fonte-fa-fede). |
| `services[].mutedUntil` | — | ISO 8601. Finché è nel futuro il provider viene interrogato e registrato come sempre ma non notifica nulla — "lo so, smetti di dirmelo, fino ad allora". Nell'edizione UI è ciò che scrive il comando **Silenzia** della dashboard. |
| `services[].options` | — | Extra specifici dell'adapter. Oggi ne accettano sei: `html` (`selector`, più le liste di parole opzionali `operational` / `degraded` / `partial_outage` / `major_outage`), `watchdog` (`baseline`, più un `selector` facoltativo), `http`, `tcp` e `dns`, e `imap` (vedi le loro sezioni qui sotto). |

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

#### L'adapter `watchdog` — qualunque cambiamento nel testo di una pagina

Per la pagina fatta solo di testo ("All systems normal") a cui non si adattano
nemmeno le parole di stato dell'adapter `html` (roadmap 1.12). Segnala qualunque
*cambiamento* del testo della pagina rispetto a una baseline che scrivi tu, e non
prova mai a dire cosa significhi:

```yaml
  - name: Prose-only provider
    id: example-prose
    adapter: watchdog
    baseUrl: https://status.example.com/
    options:
      baseline: "All systems normal."
      selector: ".notice"   # facoltativo — se assente, tutta la pagina
```

- il testo viene confrontato con gli spazi compattati e le maiuscole ignorate,
  così una riga andata a capo diversamente non è un cambiamento;
- una pagina uguale alla sua baseline legge `operational`; una diversa legge
  `degraded` — la parola meno grave che comunque non è "va tutto bene" — con un
  incidente aperto il cui titolo è il nuovo testo (tagliato a 280 caratteri). Il
  suo id è l'impronta del testo, quindi una pagina che cambia ancora apre un
  secondo incidente, e una che torna com'era lo risolve;
- `baseline` è obbligatoria ed è configurazione, non memoria: un adapter che la
  imparasse dalla prima lettura la reimparerebbe dopo un riavvio, e una pagina
  già cambiata a quel punto diventerebbe in silenzio la nuova normalità. Un
  watchdog senza baseline non si può salvare, e una lettura senza baseline
  fallisce riportando il testo che la pagina dice in quel momento — pronto da
  copiare;
- senza `selector` si sorveglia il testo di tutto il documento (esclusi i corpi
  di script e style), che nota anche un piè di pagina o una data cambiati;
  indica l'elemento quando la pagina contiene qualcosa che si muove da sé.

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
| Una sfida anti-bot (`cf-mitigated`) su uno stato che non hai accettato | `unknown` |

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
  da qui quei servizi sono davvero irraggiungibili. Comprimere la raffica in un
  unico avviso è ciò che fa `correlationThreshold` (la tabella delle
  impostazioni sopra, e §7.3 del manuale); `confirmSamples` resta
  l'impostazione per "un singolo sussulto non merita un messaggio".
- una sonda non operativa dice *perché*: **Impostazioni → riga del provider,
  espansa → Diagnostica** porta la frase che la lettura non ha dove tenere — `answered HTTP
  503, outside the accepted 200-299`, `no answer from …: connect ECONNREFUSED`,
  `the TLS certificate expires in 9 day(s)`. "Giù" e "giù perché il nome non si
  risolve più" sono la stessa severità e due problemi diversi.
- sonda **qualunque cosa questo container riesca a raggiungere**, indirizzi
  privati compresi, e non ha alcuna allowlist. È voluto per una dashboard a
  operatore singolo in ascolto su `127.0.0.1` (`BIND_HOST` e la mappatura delle porte di compose); è anche il motivo per cui un
  token API in sola lettura o una pagina pubblica in sola lettura (roadmap 4.15
  e 5.1) dovranno decidere chi può scrivere una definizione di servizio prima di
  esistere. Due limiti valgono comunque: il corpo di una risposta viene letto
  fino a **8 MiB** e una sonda che ne trasmette di più fallisce con
  `response exceeded 8388608 bytes`, e gli **indirizzi link-local**
  (`169.254.0.0/16`, `fe80::/10`, l'indirizzo di metadata `fd00:ec2::254`)
  vengono sempre rifiutati, come ogni redirect che arriva su uno di essi.
  Imposta `OUTBOUND_BLOCK_PRIVATE=true` per rifiutare anche loopback e range
  privati (`127/8`, `10/8`, `172.16/12`, `192.168/16`, `100.64/10`, `::1`,
  `fc00::/7`) — consigliato ogni volta che la dashboard è raggiungibile oltre
  questo host.
- **una sfida anti-bot non è un disservizio.** Cloudflare e simili rispondono a
  un client che non sa eseguire il loro JavaScript con `403` e un header
  `cf-mitigated` — la pagina "Just a moment…". Il bordo non ha mai chiesto nulla
  al tuo servizio, quindi la sonda legge `unknown`, che non sveglia nessuno, e
  lo scrive in **Diagnostica**. Il tuo browser apre la stessa URL perché risolve
  la sfida; questo container no. Tre vie d'uscita, nell'ordine in cui vale la
  pena provarle: sondare un `path` che la sfida salta (`/robots.txt`, un
  endpoint di salute), far passare questa macchina oltre la sfida (una regola di
  skip del WAF sul suo IP di uscita), oppure mettere lo stato in `expectStatus`
  — che legge "il bordo è in piedi" e smette di dire qualsiasi cosa sul servizio
  dietro. Ogni richiesta di questo progetto si presenta come
  `IsItDown (+https://github.com/devmanfre/isitdown)`, quindi una regola di skip
  può agganciarsi lì; `header.User-Agent` lo sostituisce se un host vuole altro.
- un'opzione sbagliata (`expectStatus: 2xx`, un `${VAR}` senza nulla dietro, un
  `expectBody` su un `HEAD`) solleva un errore a ogni ciclo e si vede come
  provider che fallisce, mai come servizio che legge giù in silenzio. `node
  dist/light/check.js --probe` lo intercetta prima del poller.

#### Gli adapter `tcp` e `dns` — sondare ciò che non parla HTTP

La sonda qui sopra ha bisogno di una risposta da leggere. Un database, un relay
SMTP o un message broker non ne manda mai una, e un nome che ha smesso di
risolversi non arriva nemmeno fin lì — quindi a quei due tocca un adapter a
testa (roadmap 1.9).

```yaml
  - name: Primary database
    id: primary-db
    adapter: tcp
    baseUrl: https://db.internal
    options:
      port: "5432"
      slowMs: "250"

  - name: Our apex record
    id: apex-dns
    adapter: dns
    baseUrl: https://example.com
    options:
      recordType: "A"
      expectValue: "203.0.113.7"
      resolver: "1.1.1.1"
```

Entrambi prendono il bersaglio da `baseUrl`, perché è il campo che lo schema
valida e un URL `http`/`https` è ciò che accetta: `tcp` ne usa l'host, e lo schema solo per decidere se parlare TLS (vedi `check`), `dns` ne risolve l'host e da lì non scarica nulla.

| Opzione | Adapter | Default | Significato |
|---|---|---|---|
| `port` | `tcp` | quella dell'URL, altrimenti quella dello schema | La porta a cui connettersi. Un valore che non è una porta solleva un errore invece di ripiegare: una sonda puntata in silenzio alla 443 leggerebbe sana la cosa sbagliata. |
| `check` | `tcp` | `connect` | Cosa chiedere alla porta: `connect` (basta aprirla), `tls` (un handshake, leggendo il certificato), `smtp` (un saluto `220`, poi un `250` a `EHLO`, poi `QUIT`), `websocket` (un `Upgrade` che deve tornare `101` con il token di accettazione che corrisponde alla chiave inviata) o `grpc` (lo standard `grpc.health.v1.Health/Check`, che deve dire `SERVING`). Roadmap 2.15. |
| `tls` | `tcp` | dallo schema dell'URL | `yes` parla TLS fin dall'inizio, cosa che una porta sicura SMTP, WebSocket o gRPC richiede. Preso da uno schema `https` se non impostato; sempre attivo con `check: tls`. |
| `verify` | `tcp` | `yes` | `no` accetta un certificato che il trust store di questa macchina non conosce — un'autorità privata. Altrimenti un certificato non fidato o scaduto legge `major_outage` con il motivo nella nota. |
| `tlsWarnDays` | `tcp` | — | Meno giorni di questi alla scadenza del certificato legge `degraded`. Richiede un handshake TLS: `check: tls`, oppure `tls: "yes"`. La stessa miccia lenta di `tlsWarnDays` su `http`, per una porta che non parla HTTP — IMAPS, LDAPS, un database. |
| `path` | `tcp` | `/` | Il percorso dell'upgrade WebSocket, per `check: websocket`. |
| `service` | `tcp` | vuoto | Il servizio su cui chiede l'health check gRPC, per `check: grpc`. Vuoto chiede del server nel suo insieme. |
| `slowMs` | entrambi | — | Un handshake o una risposta a questi millisecondi o oltre legge `degraded` invece di `operational`. |
| `recordType` | `dns` | `A` | `A`, `AAAA`, `CNAME`, `MX`, `NS` o `TXT`. Una risposta `MX` viene confrontata come `"<preferenza> <exchange>"` e una `TXT` con i suoi pezzi uniti — il modo in cui entrambe si scrivono quando qualcuno dice come dovrebbero essere. |
| `expectValue` | `dns` | — | Testo che uno dei record deve contenere. Un record puntato a un indirizzo dismesso si risolve comunque, ed è una brutta giornata diversa dal non risolversi affatto. |
| `resolver` | `dns` | quello di sistema | `1.1.1.1`, oppure `127.0.0.1:5353`. Interroga un server direttamente — per esempio uno autoritativo — invece di ciò che il resolver di questo container ha in cache. Non impostato legge ciò che sperimenta il resto dei provider monitorati. |
| `domainWarnDays` | `dns` | — | Legge la scadenza della registrazione via RDAP (roadmap 2.7): da questo numero di giorni in giù la lettura è `degraded`, una registrazione scaduta `major_outage`. Chiesto al dominio registrabile — `api.example.co.uk` → `example.co.uk` — e tenuto dodici ore. |
| `dnssec` | `dns` | — | `true` chiede a un resolver che valida se la catena DNSSEC del nome regge (roadmap 2.7): `resolver` se impostato, altrimenti `1.1.1.1`. Un indirizzo — `9.9.9.9` — chiede a quello, per una sonda il cui `resolver` è un server autoritativo, che non valida mai. |

Le letture che producono:

| Cosa è successo | Lettura |
|---|---|
| `tcp`: la porta ha accettato la connessione, sotto `slowMs` | `operational` |
| `tcp`: ha accettato, a `slowMs` o oltre | `degraded` |
| `tcp`: rifiutata, resettata, host irrisolvibile, o oltre il timeout | `major_outage` |
| `tcp` con `tlsWarnDays`: il certificato scade entro quel termine | `degraded` |
| `tcp` con un `check`: l'handshake si completa (saluto ed `EHLO` risposti, upgrade accettato, health `SERVING`) | `operational` |
| `tcp` con un `check`: l'handshake è rifiutato, risposto male o non si completa mai (saluto `421`, `200` invece di `101`, `NOT_SERVING`, un certificato non fidato) | `major_outage` |
| `dns`: sono tornati record, che soddisfano `expectValue`, sotto `slowMs` | `operational` |
| `dns`: sono tornati a `slowMs` o oltre | `degraded` |
| `dns`: NXDOMAIN, SERVFAIL, nessun record, o nulla che soddisfi `expectValue` | `major_outage` |
| `dns` con `domainWarnDays`: la registrazione scade entro quel limite | `degraded` |
| `dns` con `domainWarnDays`: la registrazione è scaduta | `major_outage` |
| `dns` con `dnssec`: il resolver non ha garantito il nome (zona non firmata, o resolver che non valida) | `degraded` |
| `dns` con `dnssec`: firme presenti e non valide — il nome si risolve solo a validazione spenta | `major_outage` |

Tutto ciò che la sezione `http` dice di una sonda vale anche per questi due —
letture invece che letture fallite, una severità e nulla più, un solo punto di
osservazione, una nota in **Diagnose** che dice perché, e un'opzione sbagliata
che solleva un errore invece di leggere giù. Due cose sono solo loro:

- `tcp` di default si connette e chiude **senza inviare un byte**. "La porta è
  aperta" è un'affermazione più piccola di "il servizio è sano", e dire solo la
  più piccola è ciò che tiene onesta la lettura. `check` fa una domanda un po'
  più grande ai servizi che hanno un solo modo standard di rispondere, e non
  di più: parla del protocollo quanto basta per vedere il servizio rispondere, e
  non invia mai nulla a una casella, una coda o una tabella.
- `dns` tratta una risposta vuota come un disservizio e non come un campo
  mancante. Ogni altro adapter degrada su un campo mancante, perché un provider
  che ne lascia cadere uno non è un disservizio nostro — ma qui la risposta *è*
  la lettura, e un record tornato vuoto significa che nessuno può raggiungere
  ciò che nomina.

`domainWarnDays` e `dnssec` sono le micce lente accanto alla risposta stessa:
una registrazione che scade e una catena di firme che si rompe si risolvono
perfettamente fino al giorno in cui non si risolve più niente. Ognuno viene
controllato solo su un nome che si è risolto, e una verifica che non ha potuto
rispondere — un registro senza servizio RDAP (diversi ccTLD, `.it` compreso), un
registro che non pubblica la scadenza, un resolver andato in timeout — viene
detta nella nota e mai contata: è un nostro punto cieco, non colpa del dominio.

#### L'adapter `sequence` — un login, poi la chiamata che ne ha bisogno

La sonda `http` legge una risposta. Un'API dietro autenticazione ne vuole due: un
login che restituisce un token, poi la chiamata che lo spende (roadmap 2.14).
`sequence` esegue due o tre richieste di fila e porta un valore dalla risposta di
una alla successiva. **Non è un browser** — niente script, niente rendering — ed è
ciò che la tiene dentro la regola del progetto di non aggiungere dipendenze.

```yaml
- name: Orders API, autenticata
  id: orders-api
  adapter: sequence
  baseUrl: https://api.example.com
  options:
    step1.method: "POST"
    step1.path: "/login"
    step1.body: '{"user":"probe","password":"${PROBE_PASSWORD}"}'
    step1.extract: "token=json:data.token"
    step2.path: "/orders?limit=1"
    step2.header.Authorization: "Bearer {{token}}"
    expectBody: '"orders"'
    slowMs: "1500"
```

Un passaggio è un gruppo di chiavi, numerate da 1 senza buchi, due o tre in tutto:

| Opzione | Default | Significato |
|---|---|---|
| `stepN.method` | `GET` | `GET`, `HEAD` o `POST`. Nient'altro: una sonda che fa `PUT` o `DELETE` a intervalli è una trappola, non una funzione. |
| `stepN.path` | vuoto | Accodato a `baseUrl`. Può usare `{{nome}}`. |
| `stepN.body` | — | Il corpo della richiesta, solo `POST`. Inviato come JSON se inizia con `{` o `[`, altrimenti form-encoded, a meno di impostare `stepN.header.Content-Type`. |
| `stepN.header.<Nome>` | — | Un header di richiesta, come `header.<Nome>` su `http`. |
| `stepN.extract` | — | Un `nome=regola` per riga; ogni passaggio tranne l'ultimo. La regola è `json:data.token` (percorso con punti, i numeri indicizzano un array), `header:X-Csrf-Token`, o `regex:name="csrf" value="([^"]+)"` (il primo gruppo è il valore, l'intera corrispondenza se non ce n'è). |
| `stepN.expectStatus` | `200-299` | Stessa sintassi di `http`. |
| `expectBody`, `absentBody`, `slowMs`, `followRedirects` | | Come su `http`; `expectBody` e `absentBody` si controllano sull'**ultimo** passaggio, `slowMs` sull'intera sequenza. |

`{{nome}}` nel percorso, nel corpo o in un header di un passaggio successivo viene
sostituito da ciò che un passaggio precedente ha estratto, e `${VAR}` da una
variabile d'ambiente, come viaggia ogni credenziale qui. I cookie impostati da un
passaggio viaggiano con il successivo, nient'altro: niente scadenza, niente
confronto di dominio.

L'ultimo passaggio è il verdetto. Una sequenza legge `operational` quando ogni
passaggio ha risposto con uno stato accettato, ogni `extract` ha trovato il suo
valore e l'ultima risposta soddisfa `expectBody` / `absentBody`; `degraded` quando
arriva in fondo ma impiega `slowMs` o più; `major_outage` quando un passaggio è
rifiutato, risponde con lo stato sbagliato o non risponde, o una regola non trova
nulla — la nota nomina il passaggio ("step 2 of 2: answered HTTP 401…"). Un errore
di battitura — un `{{toekn}}` che nessun passaggio estrae, un buco nella
numerazione, un `${VAR}` senza nulla dietro — solleva un errore invece di leggere
giù, come su `http`.

Due cose da sapere prima di puntarla su qualcosa:

- un passaggio `POST` cambia qualcosa sul servizio a ogni esecuzione della
  sequenza, e la cadenza può scendere a dieci secondi. Usalo per un login, mai per
  un ordine. Il poller non ripete mai una sonda da solo.
- un valore estratto non viene scritto da nessuna parte: né nella nota, né nel log,
  né sulla dashboard. È una credenziale più spesso che no, e la spiegazione di una
  lettura viene conservata.

Qualunque cosa non valida ferma il container all'avvio indicando motivo e percorso:
file mancante, YAML malformato, base URL sbagliato, id duplicato, lista di servizi
vuota, o un canale abilitato il cui segreto non è impostato. Un container partito con
una configurazione capita a metà sembrerebbe sano mentre in silenzio non allerta: è
l'unico modo di fallire su cui vale la pena essere rumorosi.

#### Gli adapter `icmp` e `docker` — le macchine dell'homelab

Due sonde per ciò che non ha una pagina e spesso nemmeno una porta che valga la
pena nominare (roadmap 2.6): un router, un NAS, i container che ci girano sopra.

```yaml
- name: Router
  id: router
  adapter: icmp
  baseUrl: http://192.168.1.1
  options:
    count: "3"
    slowMs: "50"

- name: NAS containers
  id: nas
  adapter: docker
  baseUrl: http://docker-socket-proxy:2375
```

**`icmp`** esegue il `ping` di sistema — quello di busybox nell'immagine, quello
di iputils su un host Linux — verso l'host di `baseUrl`. Dentro un container non
serve alcuna capability in più: Docker consente di default i socket ICMP non
privilegiati. Un host senza alcun `ping` lo dice nella nota della lettura.

| Opzione | Default | Significato |
|---|---|---|
| `count` | `3` | Richieste echo per lettura, fino a `10`. Più di una, così un singolo pacchetto perso è un tasso di perdita e non un disservizio. |
| `slowMs` | — | Un tempo di andata e ritorno medio pari o superiore a questi millisecondi è `degraded`. |

| Cosa è successo | Lettura |
|---|---|
| Tutte le richieste hanno risposto, sotto `slowMs` | `operational` |
| Tutte hanno risposto, in media pari o sopra `slowMs` | `degraded` |
| Alcune hanno risposto | `partial_outage` |
| Nessuna ha risposto, o l'host non si è risolto | `major_outage` |

**`docker`** legge un engine Docker — `GET /containers/json?all=1`, una richiesta
per lettura — e i suoi container sono i componenti del provider, scelti nello
stesso picker dei componenti di una status page, raggruppati per progetto
compose. Come raggiungere l'engine è l'unica decisione da prendere con cura:
l'API di Docker **non ha una modalità in sola lettura**, e montare
`/var/run/docker.sock` con `:ro` non la crea — chi ha il socket controlla il
demone. La strada consigliata è quindi un socket proxy che risponde solo
all'elenco dei container:

```yaml
  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy
    environment:
      CONTAINERS: 1          # GET /containers/* e nient'altro
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

con `baseUrl: http://docker-socket-proxy:2375`. Per leggere direttamente il
socket, invece, montalo e imposta `baseUrl: http://localhost` con
`options.socket: /var/run/docker.sock`.

| Container | Selezionato come componente | L'engine intero |
|---|---|---|
| in esecuzione, sano o senza health check | `operational` | conta come operativo |
| in esecuzione, health check ancora in avvio | `unknown` | si astiene |
| in esecuzione, unhealthy | `major_outage` | conta come giù |
| in riavvio (un crash loop) | `major_outage` | conta come giù |
| in pausa | `degraded` | conta come degradato |
| uscito, creato, morto — o sparito | `major_outage` | si astiene |

Le due colonne sono diverse apposta. Un container fermo è un job una tantum
finito tanto quanto un servizio morto, e un engine tenuto rosso per sempre da
un container di migrazione finito insegna all'operatore a ignorarlo; un
container che hai selezionato l'hai selezionato perché dovrebbe girare. La
lettura dell'engine si compone come quella di una status page: alcuni container
giù è `partial_outage`, tutti `major_outage`. Un engine irraggiungibile è una
lettura fallita, non un disservizio di ogni container.

### 3.2 Edizione UI — impostazioni a runtime

L'edizione UI **non** monta alcun `config.yml`; uno presente su disco verrebbe
ignorato. Tutto vive in SQLite in `/app/data/isitdown.db` e si modifica da
**Settings** nella dashboard (o tramite [`/config`](api.it.md#6-api-http)):

- intervallo di polling, timeout delle richieste, numero di tentativi, smorzamento dei rimbalzi
- la lista dei servizi: aggiungi, modifica, rimuovi
- quali canali di notifica sono attivi, quale variabile d'ambiente porta ogni
  credenziale e — in sola scrittura — la credenziale stessa
- tema, lingua della dashboard, lingua delle notifiche, fuso orario

La pagina si apre come un bento di riquadri per categoria — Polling, Servizi
monitorati, Notifiche, Consegna, Dati, Aspetto, e Rimossi di recente finché c'è
qualcosa da ripristinare. Ogni riquadro porta una breve banda in movimento che
mostra cosa fa quella categoria (il poller che spazza i provider, il fascio che
parte verso ogni canale di consegna, la retention che pota il giorno più
vecchio), disegnata con i colori del tema e tenuta ferma per chi chiede meno
animazioni al sistema. Cliccando un riquadro quella categoria si apre su una
pagina propria — `#/settings/engine`, quindi collegabile e chiudibile con il
tasto indietro del browser — con le sue righe, una barra che elenca le altre
categorie e **Tutte le impostazioni** per tornare alla griglia. Tre controlli le
accompagnano: un **filtro** sulla griglia che trova una singola impostazione per
nome e dice quale categoria la contiene (su una pagina di categoria lo stesso
campo restringe le righe di quella categoria), un interruttore **Dettagliata /
Compatta** che richiude tutti i suggerimenti una volta letti e — sopra la lista
dei provider — le etichette **Tutti / Attivi / In pausa / Silenziati** con i
rispettivi conteggi. Ogni riga di provider tiene il suo interruttore in linea;
**Silenzia**, **Diagnostica**, **Modifica** e **Rimuovi** stanno a un clic,
dentro la riga. I canali senza variabile d'ambiente impostata restano dietro
un'unica riga "mostra quelli non configurati", a meno che il filtro non li
stia cercando.

**Settings → Dati** porta anche l'unico lavoro di manutenzione che un file
SQLite richiede (roadmap 6.13): **Verifica e compatta** esegue `PRAGMA
integrity_check` e poi `VACUUM`, e riporta i byte restituiti accanto a quanto
pesa il database ora. L'ordine è voluto — un file le cui pagine sono già
sbagliate viene segnalato, non riscritto — e non cancella mai nulla: è la
pulizia giornaliera a rimuovere le righe oltre la finestra di retention, e
questo è ciò che ne restituisce le pagine.

**Settings → Dati → Controllo aggiornamenti** (roadmap 15.11a) è un
**controllo aggiornamenti**, spento di default. Acceso, legge una volta al
giorno l'elenco pubblico dei tag su GHCR per l'immagine UI di questo
progetto — al massimo una volta al giorno per ogni processo in esecuzione,
compreso un controllo all'avvio — e confronta il tag `ui-v<semver>` più
recente trovato con la versione con cui è stato compilato questo processo; i
tag che non sono semver (`ui-latest`, `latest`, …) vengono ignorati. Se
esiste un tag più recente, accanto all'impostazione compare un badge
"`<versione>` disponibile"; se questa istanza è già sul tag più recente, nulla
cambia a schermo. Solo la lettura dell'elenco tag lascia la macchina — nessun
download automatico, nessuna installazione automatica, e nulla oltre alla
richiesta stessa: nessun provider configurato, nessun conteggio, nessun
identificativo di istanza e nessun header che descriva questa istanza viaggia
con essa, solo ciò che una normale lettura anonima di un registro pubblico
rivela a GitHub (l'indirizzo IP di questa istanza e l'ora della richiesta). Un
errore di rete, un timeout o una risposta che non si può interpretare non
emergono mai come errore nella dashboard e non inviano mai una notifica su
nessun canale — l'impostazione si limita a mostrare "ultimo controllo non
riuscito, si riprova domani", registrato a livello debug sul server e per il
resto silenzioso.

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
| `PUSHOVER_TOKEN` | entrambe | — | Token API dell'applicazione Pushover. Obbligatoria se il canale Pushover è attivo. |
| `PUSHOVER_USER_KEY` | entrambe | — | User key (o group key) di Pushover. Obbligatoria insieme alla precedente. |
| `PUSHOVER_DEVICE` | entrambe | — | Opzionale. Un singolo dispositivo registrato; se vuota la notifica arriva su tutti. |
| `TEAMS_WEBHOOK_URL` | entrambe | — | Webhook del canale Microsoft Teams. Obbligatoria se il canale Teams è attivo. |
| `MATRIX_HOMESERVER_URL` | entrambe | — | Radice dell'homeserver Matrix (`https://matrix.example.org`). Obbligatoria se il canale Matrix è attivo. |
| `MATRIX_ROOM_ID` | entrambe | — | Id interno della stanza (`!ops:example.org`), non un alias. Obbligatoria con la precedente. |
| `MATRIX_ACCESS_TOKEN` | entrambe | — | Access token dell'utente che pubblica. Obbligatoria con le precedenti. |
| `PAGERDUTY_ROUTING_KEY` | entrambe | — | Integration key di un'integrazione Events API v2. Obbligatoria se il canale PagerDuty è attivo. |
| `PAGERDUTY_REGION` | entrambe | — | Opzionale. `eu` per un account nella service region europea di PagerDuty. |
| `OPSGENIE_API_KEY` | entrambe | — | Chiave API di un'integrazione Opsgenie. Obbligatoria se il canale Opsgenie è attivo. |
| `OPSGENIE_REGION` | entrambe | — | Opzionale. `eu` per un account sull'istanza europea di Opsgenie. |
| `APPRISE_SERVER_URL` | entrambe | — | Server API Apprise (`http://apprise:8000`). Obbligatoria se il canale Apprise è attivo. |
| `APPRISE_CONFIG_KEY` | entrambe | — | Chiave di una configurazione salvata sul server Apprise. Serve questa oppure `APPRISE_URLS`. |
| `APPRISE_URLS` | entrambe | — | URL dei servizi Apprise, separati da virgola, per un server stateless. Serve questa oppure `APPRISE_CONFIG_KEY`. |
| `SPLUNK_ONCALL_API_KEY` | entrambe | — | Chiave API dell'endpoint REST di Splunk On-Call. Obbligatoria se quel canale è attivo. |
| `SPLUNK_ONCALL_ROUTING_KEY` | entrambe | — | La routing key che sceglie la policy di escalation. Obbligatoria con la precedente. |
| `SQUADCAST_WEBHOOK_URL` | entrambe | — | URL dell'Incident Webhook di Squadcast. Obbligatorio se quel canale è attivo. |
| `ZENDUTY_INTEGRATION_KEY` | entrambe | — | Chiave di un'integrazione API di Zenduty. Obbligatoria se quel canale è attivo. |
| `INCIDENT_IO_ALERT_SOURCE_ID` | entrambe | — | Config id della alert source HTTP di incident.io. Obbligatorio se quel canale è attivo. |
| `INCIDENT_IO_TOKEN` | entrambe | — | Il bearer token di quella alert source. Obbligatorio con il precedente. |
| `GRAFANA_ONCALL_WEBHOOK_URL` | entrambe | — | URL del Formatted Webhook di Grafana OnCall. Obbligatorio se quel canale è attivo. |
| `MATTERMOST_URL` | entrambe | — | Server Mattermost (`https://chat.example.com`). Obbligatorio se quel canale è attivo. |
| `MATTERMOST_TOKEN` | entrambe | — | Il token di un account bot. Obbligatorio con il precedente. |
| `MATTERMOST_CHANNEL_ID` | entrambe | — | L'id del canale, non il nome. Obbligatorio con il precedente. |
| `ROCKETCHAT_URL` | entrambe | — | Server Rocket.Chat. Obbligatorio se quel canale è attivo. |
| `ROCKETCHAT_USER_ID` | entrambe | — | L'id dell'utente bot. Obbligatorio con il precedente. |
| `ROCKETCHAT_TOKEN` | entrambe | — | Un personal access token di quell'utente. Obbligatorio con il precedente. |
| `ROCKETCHAT_ROOM_ID` | entrambe | — | L'id della stanza, non il suo `#nome`. Obbligatorio con il precedente. |
| `ZULIP_SITE_URL` | entrambe | — | Organizzazione Zulip (`https://example.zulipchat.com`). Obbligatoria se quel canale è attivo. |
| `ZULIP_BOT_EMAIL` | entrambe | — | L'indirizzo email del bot. Obbligatorio con il precedente. |
| `ZULIP_API_KEY` | entrambe | — | La chiave API del bot. Obbligatoria con il precedente. |
| `ZULIP_STREAM` | entrambe | — | Il canale (stream) in cui scrivere. Obbligatorio con il precedente. |
| `ZULIP_TOPIC` | entrambe | — | Opzionale. Un topic fisso; se non impostato ogni provider ha il suo. |
| `GOOGLE_CHAT_WEBHOOK_URL` | entrambe | — | Il webhook in entrata di uno spazio Google Chat. Obbligatorio se quel canale è attivo. |
| `TWILIO_SMS_ACCOUNT_SID` | entrambe | — | Account SID Twilio (`AC…`) per gli SMS. Obbligatorio se il canale SMS è attivo. |
| `TWILIO_SMS_AUTH_TOKEN` | entrambe | — | L'auth token di quell'account. Obbligatorio con il precedente. |
| `TWILIO_SMS_FROM` | entrambe | — | Il numero Twilio da cui scrivere, E.164. Obbligatorio con il precedente. |
| `TWILIO_SMS_TO` | entrambe | — | Il numero a cui scrivere, E.164. Obbligatorio con il precedente. |
| `TWILIO_CALL_ACCOUNT_SID` | entrambe | — | Account SID Twilio per le chiamate. Obbligatorio se il canale chiamata è attivo. Variabile propria anche per lo stesso account: due canali non ne condividono mai una. |
| `TWILIO_CALL_AUTH_TOKEN` | entrambe | — | L'auth token di quell'account. Obbligatorio con il precedente. |
| `TWILIO_CALL_FROM` | entrambe | — | Il numero Twilio da cui chiamare, E.164. Obbligatorio con il precedente. |
| `TWILIO_CALL_TO` | entrambe | — | Il numero da chiamare, E.164. Obbligatorio con il precedente. |
| `BARK_DEVICE_KEY` | entrambe | — | La device key mostrata dall'app Bark per iOS. Obbligatoria se quel canale è attivo. |
| `BARK_SERVER_URL` | entrambe | — | Opzionale. Un bark-server self-hosted; se non impostato si usa `https://api.day.app`. |
| `SIGNAL_API_URL` | entrambe | — | Un server signal-cli-rest-api (`http://signal-api:8080`). Obbligatorio se quel canale è attivo. |
| `SIGNAL_NUMBER` | entrambe | — | Il numero registrato da cui partono i messaggi, E.164. Obbligatorio con il precedente. |
| `SIGNAL_RECIPIENTS` | entrambe | — | Numeri o id `group.…`, separati da virgola. Obbligatorio con il precedente. |
| `SYSLOG_URL` | entrambe | — | `udp://host:514`, `tcp://host:601` o `tls://host:6514`. Obbligatorio se quel canale è attivo. |
| `SYSLOG_FACILITY` | entrambe | `local0` | Opzionale. Da `local0` a `local7`. |
| `MQTT_BROKER_URL` | entrambe | — | `mqtt://broker:1883`, o `mqtts://` per TLS. Obbligatorio se quel canale è attivo. |
| `MQTT_TOPIC` | entrambe | `isitdown` | Opzionale. Prefisso dei topic; i messaggi vanno su `<prefisso>/<provider>`. |
| `MQTT_USERNAME` | entrambe | — | Opzionale. Solo per un broker che chiede credenziali. |
| `MQTT_PASSWORD` | entrambe | — | Opzionale. Inviata solo insieme a un nome utente. |
| `MASTODON_INSTANCE_URL` | entrambe | — | Istanza Mastodon (`https://mastodon.social`). Obbligatoria se quel canale è attivo. |
| `MASTODON_ACCESS_TOKEN` | entrambe | — | Il token di un'applicazione con `write:statuses`. Obbligatorio con il precedente. |
| `MASTODON_VISIBILITY` | entrambe | `public` | Opzionale. `public`, `unlisted` o `private`. |
| `BLUESKY_HANDLE` | entrambe | — | L'handle dell'account. Obbligatorio se quel canale è attivo. |
| `BLUESKY_APP_PASSWORD` | entrambe | — | Una app password, mai la password dell'account. Obbligatoria con il precedente. |
| `BLUESKY_SERVICE_URL` | entrambe | `https://bsky.social` | Opzionale. Il PDS dell'account. |
| `WEBHOOK_SECRET` | entrambe | — | Segreto condiviso opzionale per il webhook generico. Impostandolo ogni richiesta viene firmata (vedi [3.6](#36-canali-di-notifica)); lasciandolo vuoto le richieste partono non firmate, esattamente come prima. |
| `LOG_LEVEL` | entrambe | `info` | `debug` · `info` · `warn` · `error`. |
| `PLUGINS_DIR` | entrambe | — | Una cartella di plugin adapter da caricare all'avvio ([3.14](#314-plugin-adapter)). Non impostata — il valore predefinito, anche nelle immagini — non carica nulla. **Un plugin gira con i privilegi di questo processo.** |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | entrambe | — | L'URL base di un collector OTLP/HTTP; `/v1/traces` viene aggiunto. Impostarla attiva il tracing ([3.16](#316-tracce)). Se non è impostata non viene tracciato nulla e non viene allocato nulla. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | entrambe | — | L'endpoint delle tracce esatto, quando non è `<base>/v1/traces`. Ha la precedenza sulla variabile qui sopra. |
| `OTEL_EXPORTER_OTLP_HEADERS` | entrambe | — | `chiave=valore,altra=valore` — una API key che un collector gestito richiede. |
| `OTEL_SERVICE_NAME` | entrambe | `isitdown` | Come il collector etichetta questo processo. |
| `OUTPOSTS` | entrambe | — | Gli outpost a cui chiedere una seconda lettura di ogni sonda, URL base separati da virgola (`https://vps-1.example.com:8080`) — roadmap 1.7, vedi [Docker §4.7](docker.it.md#47-outpost--un-secondo-punto-di-vista-per-le-sonde). Non impostata — il default — ogni sonda resta la sola lettura di questo container. |
| `OUTPOST_TOKEN` | entrambe, outpost | — | Il bearer token con cui è stato avviato ogni outpost. Obbligatoria insieme a `OUTPOSTS`; un outpost senza non parte. |
| `LOG_FILE` | entrambe | — | Accoda ogni riga di log anche a questo file, ruotato per dimensione. Se non è impostata, i log vanno solo su stdout. |
| `LOG_MAX_BYTES` | entrambe | `5242880` | Dimensione alla quale `LOG_FILE` ruota. |
| `LOG_MAX_FILES` | entrambe | `5` | Quante generazioni ruotate (`.1` … `.5`) sopravvivono accanto al file vivo. |
| `CONFIG_PATH` | Light | `/app/config/config.yml` | Dove leggere `config.yml`. |
| `DATA_PATH` | Light | `/app/data/state.json` | Dove tenere il file di stato. |
| `DB_PATH` | UI | `/app/data/isitdown.db` | Database SQLite. |
| `API_TOKEN` | UI | — | Un token bearer di sola lettura ([3.12](#312-raggiungere-lapi-da-un-altro-host)). Non impostato — il valore predefinito — lascia ogni rotta aperta, che è giusto per un'istanza legata a `127.0.0.1`. Impostandolo, una richiesta che lo porta può fare `GET` da qualunque host; le scritture restano solo locali. |
| `API_LOCAL_BYPASS` | UI | `true` | Se una richiesta da questa macchina possa saltare `API_TOKEN`. Impostalo a `false` dietro un reverse proxy, dove ogni richiesta inoltrata sembra locale. |
| `ALLOWED_HOSTS` | UI | — | Hostname extra, separati da virgola, con cui la dashboard può essere servita (ad es. il nome di un reverse proxy). Una scrittura il cui `Origin` o `Host` non sia quello della dashboard, `localhost` o un indirizzo IP viene rifiutata con `403`. Nessun wildcard. |
| `TELEGRAM_CHATOPS` | UI | `false` | Impostala a `true` perché il bot Telegram accetti comandi oltre a inviare avvisi ([3.17](#317-chatops--comandare-il-bot-da-telegram)). Spento per default: un canale di comando in entrata è una cosa che si sceglie. |
| `TELEGRAM_COMMAND_CHAT_IDS` | UI | — | Altre chat autorizzate a comandare il bot, separate da virgola. La chat a cui il canale Telegram già invia è sempre autorizzata; questa serve a un'installazione avvisata in una chat e comandata da un'altra. |
| `PUBLIC_PAGE` | UI | `false` | Impostala a `true` per pubblicare una pagina di stato in sola lettura su `/public` ([3.18](#318-la-pagina-di-stato-pubblica)). Spenta per default: è l'unica superficie che possono leggere degli estranei. |
| `PUBLIC_PAGE_TITLE` | UI | `Service status` | Il titolo della pagina e quello del browser. |
| `PUBLIC_PAGE_PROVIDERS` | UI | — | Quali provider pubblicare, per id e separati da virgola. Se non è impostata pubblica tutti i provider attivi. Un visitatore non può allargare l'elenco: la pagina non legge nulla dalla richiesta. |
| `PUBLIC_PAGE_LOCALE` | UI | — | La lingua in cui è scritta quella pagina. Se non è impostata segue il locale delle notifiche dell'installazione. |
| `PUSH_TOKEN` | UI | — | Attiva l'endpoint per i webhook dei provider ([3.15](#315-push-del-provider-invece-del-polling)) ed è la credenziale nel suo URL. Se non è impostata, quella rotta risponde `404`. |
| `HEARTBEAT_TOKEN` | UI | — | Attiva l'endpoint dei ping heartbeat ([3.19](#319-heartbeat--il-dead-mans-switch)) ed è la credenziale nel suo URL. Se non è impostata, quella rotta risponde `404`. |
| `OUTBOUND_BLOCK_PRIVATE` | entrambe | non impostata | `true` fa rifiutare a sonde e letture delle pagine di stato i target loopback e dei range privati (e i redirect verso di essi), oltre agli indirizzi link-local che sono sempre rifiutati. Qualsiasi altro valore lascia consentiti i target privati. |
| `BIND_HOST` | UI | `127.0.0.1` | L'indirizzo su cui la dashboard è in ascolto. Per impostazione predefinita è il loopback, ciò che mantiene un'istanza senza `API_TOKEN` raggiungibile solo da questa macchina; le immagini container impostano `0.0.0.0` (la mappatura `ports` di compose decide poi chi può raggiungerla, e pubblica solo su `127.0.0.1`). Per raggiungere la dashboard da un'altra macchina, pubblica su `0.0.0.0` (o imposta `BIND_HOST` su bare metal) **e** imposta `API_TOKEN` — vedi [3.12](#312-raggiungere-lapi-da-un-altro-host) per ciò che una richiesta da fuori questa macchina può fare. |
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

Nell'edizione UI il dialog di aggiunta lo chiede in due passi. Il primo chiede
soltanto da dove arriva lo stato, e offre i tre modi di rispondere: il
**catalogo** incluso, un URL incollato, o un adapter scelto a mano. Il secondo
sono i campi — nome, gruppo, intervallo di polling, componenti — con la risposta
del primo riportata in testa e tutto ciò che è specifico dell'adapter raccolto
sotto **Avanzate**. Modificare un servizio esistente resta una pagina sola: il
suo adapter è fissato, e ciò che resta è la messa a punto.

Il catalogo (roadmap 5.11) è una griglia di provider noti, cercabile per nome, e
una scelta riempie adapter, base URL e id. Dalla roadmap 2.1 è un artefatto
generato invece che una lista scritta a mano: un job settimanale
(`tools/build-catalog.mjs`, vedi [9.4](development.it.md#94-test-e-controlli)) legge un seed
curato e le liste pubbliche di status page, passa ogni candidato per la stessa
detection usata dalla dashboard, poi lo legge una volta tramite il suo adapter,
e tiene solo ciò che ha risposto — circa duecento provider, in
`src/adapters/catalog.json`. Quindi ciò che la griglia offre è ciò che un adapter
legge davvero. I
provider la cui status page rifiuta una lettura automatica (Stripe, GitLab,
Zendesk, Okta) sono volutamente assenti invece che elencati e rotti — per
quelli, e per tutto ciò che la lista non ha, si incolla l'URL e si lascia che la
detection (`POST /config/services/detect`) nomini l'adapter. Una voce già
monitorata resta nella griglia, in grigio, invece di sparire. Servito come
`GET /config/catalog`.

Gli **aggiornamenti del catalogo** (roadmap 2.2, **Impostazioni → Dati → Aggiorna
il catalogo dei provider**, spenti di default) tengono aggiornata quella lista
senza una nuova immagine. Se attivati, l'edizione UI scarica
`catalog/catalog.json` dal ramo `main` del progetto una volta al giorno — e una
volta subito quando si attiva l'interruttore — e ne verifica la firma Ed25519
con la chiave pubblica compilata nella build. Una lista la cui firma non
corrisponde, che non è un catalogo, o che non è più recente di quella inclusa
nell'immagine viene ignorata; le righe che nominano un adapter che questa build
non ha vengono scartate. L'ultima copia valida resta nel database, così un
riavvio non torna indietro. La richiesta non porta nulla di questa istanza oltre
a ciò che qualunque lettura anonima di GitHub rivela (indirizzo IP e orario).

Una lista scaricata non modifica mai da sola un provider configurato. Quando un
provider che monitori ha l'id di una voce del catalogo il cui adapter o URL ora
è diverso — "GitHub ha spostato la sua pagina di stato" — l'impostazione lo
elenca con **Aggiorna** e **Tieni il mio**. Aggiorna è una normale modifica del
servizio; Tieni il mio ricorda quel valore preciso, quindi la domanda torna solo
se il catalogo si sposta una seconda volta.

**Trovare i provider da un progetto** (roadmap 2.3). `isitdown discover <percorso>`
([10.2](cli.it.md#102-isitdown-discover)) legge `package.json`, file compose,
Dockerfile, `.env`, Terraform, `requirements.txt`, `pyproject.toml`, `go.mod` o
un file hosts di un progetto e propone i provider del catalogo da cui dipende,
ciascuno con la riga che l'ha tradito; `--yaml` stampa un blocco `services:` per
`config.yml`. L'edizione UI risponde alla stessa domanda su `POST /config/discover`.

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

#### L'adapter IMAP — le email del vendor

Alcuni vendor non pubblicano nessuna pagina di stato leggibile da una macchina e
annunciano i problemi scrivendo ai clienti. `adapter: imap` legge quegli avvisi
da una casella di posta (roadmap 1.4) — dagliene una che riceve solo gli avvisi
dei vendor, un indirizzo dedicato o una cartella in cui una regola li smista:

```yaml
  - id: acme-mail
    name: Acme (mail)
    adapter: imap
    baseUrl: https://imap.example.com     # il server di posta; lo schema è ignorato
    crossChecks: acme                     # facoltativo: la pagina di Acme, vedi sotto
    options:
      user: ${ACME_IMAP_USER}
      passwordEnv: ACME_IMAP_PASSWORD     # il nome della variabile, mai la password
      from: status@acme.example, acme.example
      mailbox: Vendors/Acme
```

| Opzione | Predefinito | Significato |
|---|---|---|
| `user` | — | Obbligatoria. Il login della casella, così com'è o come riferimento `${VAR}`. |
| `passwordEnv` | — | Obbligatoria. Il **nome** della variabile d'ambiente che contiene la password. Un'opzione `password` viene rifiutata del tutto: il segreto non sta mai in `config.yml` né in un export delle impostazioni. Un nome invece di `${VAR}` perché la Light risolve ogni `${VAR}` al caricamento, e a quel punto l'adapter non potrebbe più distinguere un riferimento da una password scritta lì. |
| `from` | — | Obbligatoria. Indirizzi o domini del mittente, separati da virgola; le email di chiunque altro vengono ignorate. |
| `subject` | — | Parole, separate da virgola: contano solo gli oggetti che ne contengono una. Se manca, conta ogni email del mittente. |
| `mailbox` | `INBOX` | La cartella da leggere. |
| `port` | `993`, o `143` con `tls: no` | |
| `tls` | `yes` | TLS implicito. `no` solo per un bridge o un relay sul loopback — altrimenti il login attraverserebbe la rete in chiaro. |
| `windowHours` | `24` | Per quanto un annuncio conta come aperto se nessuna email lo chiude. |

La casella viene aperta **in sola lettura** (`EXAMINE`, intestazioni lette con
`BODY.PEEK`): niente viene segnato come letto, spostato o cancellato, quindi chi
legge la stessa cartella a mano la trova intatta. Ogni poll legge Da, Oggetto e
Data delle email ricevute nella finestra — al massimo le 200 più recenti — e
nient'altro.

Le email si leggono come l'adapter RSS legge le voci, con un miglioramento: le
email di uno stesso incidente vengono raggruppate in un thread, per oggetto,
tolti i prefissi di risposta, i `[tag]` e le parole di ciclo di vita
(`investigating`, `update`, `resolved`, …), così "[Acme] Resolved: API errors"
chiude "[Acme] Investigating: API errors".

| Ultima email di un thread | Lettura |
|---|---|
| Ricevuta entro `windowHours`, nessuna parola di chiusura | Un incidente aperto |
| Dice `resolved`, `completed`, `restored`, `closed`, `fixed` | Chiuso |
| Più vecchia di `windowHours` | Non più attuale |
| Senza data | Trattata come attuale |

La gravità viene dalle parole dell'oggetto, come per un feed. Un server
irraggiungibile, un login rifiutato o una casella inesistente sono una **lettura
fallita**, non un guasto: vuol dire che IsItDown non vede la casella, il che non
dice nulla del vendor.

Con `crossChecks` che indica la pagina del vendor, un'email che annuncia un
problema mentre la pagina dice ancora operativo diventa lo **stato sospetto** di
quella pagina (roadmap 1.3, [come funziona §7.9](how-it-works.it.md#79-stato-sospetto))
e un unico avviso di guasto silenzioso, esattamente come la lettura di una
sonda — l'oggetto dell'email è la nota mostrata accanto. Senza `crossChecks` la
casella è semplicemente lo stato del provider, per un vendor che nessun altro
adapter può raggiungere.

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
      regions: eu-west-1       # opzionale; omesso, guarda ogni regione (vedi sotto)

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
`options.regions` restringe alla tua (vedi sotto). Un evento globale — uno che il feed
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

**Restringere alle tue regioni e ai tuoi servizi** (roadmap 2.8). I tre feed
coprono ogni regione del pianeta, e un incidente in `ap-south-1` è rumore per
chi sta a Francoforte. Le stesse due opzioni su `aws`, `gcp` e `azure`,
entrambe separate da virgole:

```yaml
    options:
      regions: eu-west-1, eu-central-1      # aws; gcp: europe-west1; azure: westeurope
      services: EC2, S3                     # opzionale
```

| Opzione | Confrontata con |
|---|---|
| `regions` | AWS: la regione dell'evento (`eu-west-1`). Google Cloud: gli id delle location colpite dall'incidente (`europe-west1`) — per uno risolto, i luoghi che ha colpito. Azure: la regione in fondo al titolo della voce (`West Europe`). Il confronto ignora maiuscole, spazi e trattini, quindi `westeurope` e `West Europe` sono la stessa regione. Il vecchio `region` di AWS viene ancora letto quando manca `regions`. |
| `services` | AWS: il nome del servizio (`Amazon Simple Storage Service`) o la sua chiave breve (`s3`). Google Cloud: i prodotti colpiti (`Cloud Storage`). Azure: i servizi nominati nel titolo (`Virtual Machines`). Confrontati allo stesso modo. |

Un incidente che il feed non colloca da nessuna parte — globale, "multiple
regions", o semplicemente senza etichetta — passa sempre il filtro per regione,
e uno che non nomina servizi, o "multiple services", passa sempre il filtro per
servizio: sono proprio gli incidenti che un restringimento non deve nascondere.
Le cronologie degli incidenti di Google Cloud e Azure vengono ristrette con la
stessa regola.

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
questo progetto si ospita da sé — il parco provider può includere la status page del
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

**JSON generico (`json`)** — roadmap 11.1, ed è la cosa da provare prima di
scrivere codice. Moltissime status page servono JSON ottimo in una forma che
nessuno ha standardizzato: il dato è stabile e completo, e l'unica cosa che manca
è qualcuno che dica quale campo significa cosa. È ciò che questo adapter prende.

```yaml
services:
  - name: Acme Cloud
    id: acme
    adapter: json
    baseUrl: https://status.acme.example
    options:
      path: /api/status
      statusPath: service.state
      statusMap: '{"UP":"operational","DEGRADED":"degraded","PARTIAL":"partial_outage","DOWN":"major_outage"}'
      incidentsPath: events
      incidentId: ref
      incidentName: title
      incidentStatus: phase
      incidentImpact: severity
      incidentUpdatedAt: changedAt
```

| Opzione | Significato |
|---|---|
| `path` | Aggiunto a `baseUrl`. Ometti quando l'URL base è già il documento. |
| `statusPath` | Dov'è la parola dello stato complessivo. **Obbligatoria.** |
| `statusMap` | Un oggetto JSON che mappa le parole del provider su `operational`, `degraded`, `partial_outage`, `major_outage` o `unknown`. **Obbligatoria.** Il confronto ignora maiuscole e spazi attorno. |
| `incidentsPath` | Un array di incidenti aperti. Ometti per una pagina che pubblica solo uno stato. |
| `incidentName` | Il titolo, *dentro una voce*. Obbligatoria ogni volta che c'è `incidentsPath`: una voce senza nome è una riga vuota sulla timeline, quindi viene scartata anziché mostrata. |
| `incidentId`, `incidentStatus`, `incidentImpact`, `incidentUpdatedAt` | Il resto di una voce. Opzionali; una voce senza id proprio è identificata dalla posizione, così due letture concordano su quale incidente è quale. |

Un **percorso** è nomi, punti e `[n]` per un indice di array — `page.status`,
`components[0].state`. Deliberatamente non JSONPath: qui un percorso è una
lettura, e un linguaggio di espressioni è una superficie con filtri, wildcard e
prima o poi un parser da mantenere. Una pagina che ha bisogno di più di una
lettura ha bisogno di un adapter.

Due comportamenti da conoscere. Una parola di stato che la tabella non copre
legge `unknown` invece di essere indovinata dall'euristica sulle parole usata
dall'adapter feed: l'operatore ha descritto il vocabolario di questo provider, e
un buco lì è una cosa di cui *essere avvisati*. E una pagina che riporta
`operational` mentre elenca un incidente aperto legge `degraded` — è una pagina a
metà aggiornamento, e riportare la più tranquilla delle due significherebbe
riportare quella che già sappiamo superata.

La mappatura viene validata quando si **salva**, non quando si legge: `POST`/`PATCH
/config/services` rispondono `400` nominando ogni problema, e `isitdown check` li
riporta come errori. Un refuso in un percorso è una cosa da correggere mentre si
sta ancora guardando il campo in cui lo si è scritto.

Per un provider che non sta su nessuno di questi, aggiungi un adapter sotto
`src/adapters/`.

#### Altre piattaforme di stato, altre istanze e segnali da sviluppatore

Roadmap 2.11, 2.12 e 2.13. Ognuno è un adapter; tutti tranne `registry` leggono
con lo stesso percorso a richieste condizionali di una pagina di stato, quindi
`header.<Name>` e `tokenEnv` funzionano (vedi *Fonti private e autenticate*).

| `adapter` | URL di base | Opzioni | Legge |
|---|---|---|---|
| `isitdown` | L'origine dell'altra istanza, `https://status.amico.example` | `provider` — uno dei suoi id | Il suo `GET /status`: i provider diventano i componenti, lo stato è il peggiore tra loro |
| `upptime` | Il repository, `https://github.com/owner/repo` | `branch` (default `HEAD`) | `history/summary.json`, un sito per componente |
| `statusio` | L'endpoint, `https://api.status.io/1.0/status/<id pagina>` — o l'host più `pageId` | `pageId` | L'API pubblica di stato: codice complessivo, componenti, incidenti, manutenzioni |
| `githubactions` | Il repository, `https://github.com/owner/repo` | `workflow` (un nome di file), `branch`, `apiBase` (Enterprise) | L'ultima esecuzione *completata* |
| `openstatus` | La pagina, `https://acme.openstatus.dev` | `slug` (default: la prima etichetta dell'host), `apiBase` | `GET /public/status/<slug>`: solo la parola complessiva |
| `sorry` | La pagina, `https://status.example.com` | — | `/api/v1/status`, `/components`, `/notices` |
| `cstate` | La pagina, `https://status.example.com` | — | `index.json` (API v2.0 di cState) |
| `registry` | L'origine API: `https://registry.npmjs.org`, `https://pypi.org`, `https://hub.docker.com`, `https://crates.io`, `https://data.jsdelivr.com`, `https://api.cdnjs.com`, `https://unpkg.com` | `registry` (`npm`, `pypi`, `dockerhub`, `crates`, `jsdelivr`, `cdnjs`, `unpkg`) e `package`, entrambi obbligatori; `pinned` | I metadati di un pacchetto reale |

**`isitdown` — federazione.** Nessun protocollo nuovo: un'istanza pubblica già
`/status` nel vocabolario che questo adapter legge. Il composito è il peggiore tra
i provider *abilitati* dell'altra istanza (`unknown` si astiene, la regola dei
gruppi della dashboard); incidenti e manutenzioni aperti arrivano con il nome del
provider come prefisso, e `scopeToComponents` considera solo i provider spuntati.
Un provider dell'altra istanza che sparisce legge `unknown`, mai operativo. Il
`/status` dell'altra istanza deve essere raggiungibile: dietro un reverse proxy,
passa la credenziale come `header.Authorization` o `tokenEnv`. Nella pagina
pubblica l'URL di base è trattato come privato, perché di solito è tuo.

**`upptime`** legge il riepilogo committato nel repository da
`raw.githubusercontent.com`. `up` è operativo, `degraded` degradato, `down` un
disservizio grave; la pagina si riduce come quella di Uptime Kuma (qualche sito
giù è un disservizio *parziale*, tutti giù uno grave). Upptime tiene i disservizi
come issue di GitHub e non nel riepilogo, quindi non si riporta alcun incidente.

**`openstatus`** legge l'unica parola che OpenStatus pubblica su
`api.openstatus.dev/public/status/<slug>` (`operational`, `degraded_performance`,
`partial_outage`, `major_outage`, `incident`, `under_maintenance`); l'endpoint
pubblico non ha componenti né incidenti, quindi non se ne riportano.

**`sorry`** legge l'API pubblica di una pagina Sorry™. Le tre parole diventano
`operational` operativo, `partially-degraded` degradato e `degraded` un
disservizio parziale. Un avviso `unplanned` aperto è un incidente, uno `planned`
non completato né annullato una finestra di manutenzione; gli avvisi `general`
sono annunci e si ignorano.

**`cstate`** legge l'`index.json` della pagina costruita con Hugo: `ok`,
`disrupted`, `down` per sistema e per pagina. I sistemi sono i componenti, indicati
con il nome, e le issue che elencano come non risolte sono gli incidenti.

**incident.io** non ha bisogno di un adapter: le sue pagine servono
`/api/v2/summary.json` nel formato di Statuspage, quindi le legge `statuspage`
(e il rilevamento automatico). Lo stesso vale per una pagina Atlassian Statuspage
*per un pubblico specifico*: passa la credenziale come `header.<Name>` o
`tokenEnv`, `statuspage` la invia.

**Non coperti, e perché.** Hund.io ha solo un'API di gestione autenticata i cui
campi di stato non si sono potuti verificare su una pagina reale; StatusCast e
Statusfy non pubblicano un endpoint di stato pubblico documentato. Una pagina di
una qualsiasi di queste si legge comunque con la mappatura `json` generica, `rss`
o `html`.
**`statusio`** traduce i codici di Status.io: 100 operativo, 200 manutenzione
pianificata (si astiene), 300 degradato, 400 disservizio parziale, 500
disservizio, 600 evento di sicurezza (parziale). Un codice sconosciuto legge come
disservizio grave. L'id della pagina non sta nell'URL pubblico: si copia dalla
scheda *API* della pagina.

**`githubactions`** trasforma "main è rosso" in uno stato. `success` è operativo;
`failure` e `timed_out` disservizio grave; `action_required` e `startup_failure`
degradato; `cancelled`, `skipped` e `neutral` si astengono. Un'esecuzione fallita
è riportata come un incidente che nomina l'esecuzione. L'API senza autenticazione
concede 60 richieste l'ora per indirizzo: con più di un paio di repository serve
`tokenEnv`. 

**`registry`** è una sonda (`intervalSeconds` funziona): chiede al registry o alla CDN i
metadati di un pacchetto da cui dipendi, così una home che si carica mentre l'API
risponde 502 legge comunque giù. Un 2xx con corpo JSON è operativo; un 404 o un
2xx che non sono metadati sono degradati (il registry ha risposto, il pacchetto va
guardato da te); un 429 si astiene; tutto il resto, nessuna risposta compresa, è
un disservizio grave. Con `pinned` (`1` o `1.4.2`) una *major più recente* della versione fissata
legge degradato e apre un incidente — "left-pad 2.0.0 è uscita, tu fissi 1.4.2" —
che è il segnale di release: non un disservizio, ma un breaking change da sapere.
Sparisce quando alzi il pin. Docker Hub non ha una versione da confrontare e
rifiuta `pinned`.

```yaml
services:
  - id: friend-lab
    name: Homelab dell'amico
    adapter: isitdown
    baseUrl: https://status.amico.example
  - id: npm
    name: Registry npm
    adapter: registry
    baseUrl: https://registry.npmjs.org
    options: { registry: npm, package: left-pad }
  - id: ci
    name: CI su main
    adapter: githubactions
    baseUrl: https://github.com/owner/repo
    options: { workflow: ci.yml, branch: main, tokenEnv: GITHUB_TOKEN }
```

#### Fonti private e autenticate

Ogni adapter che legge una pagina via HTTP — tutti tranne le sonde e `imap` — può
portare delle credenziali, per una fonte che risponde solo a chi conosce:
Microsoft 365 Service Health sulla Graph API, una pagina Atlassian Cloud
autenticata, Meraki, Zendesk, qualunque cosa dietro un token. Tre forme, da
mettere nelle `options` del provider e combinabili:

| Opzione | Cosa invia |
|---|---|
| `header.<Nome>` | Un header di richiesta per opzione, esattamente come sulla sonda `http`: un `${VAR}` nel valore viene risolto dall'ambiente al momento della richiesta. Scritto per ultimo, quindi `header.Authorization` prevale sulle due sotto. |
| `tokenEnv` | `Authorization: Bearer <valore>` — il *nome* della variabile che contiene il token. |
| `oauthTokenUrl`, `oauthClientId`, `oauthClientSecretEnv`, `oauthScope` | Client credentials OAuth 2.0. Le prime tre vanno insieme; `oauthScope` è facoltativo. Il token viene richiesto alla prima lettura, riusato fino a un minuto prima della scadenza, e scartato su un `401`/`403` così che la lettura successiva ne chieda uno nuovo. |

Un segreto viene solo *nominato*: `tokenEnv` e `oauthClientSecretEnv` prendono il
nome di una variabile, e un `token` o un `oauthClientSecret` scritti in chiaro
vengono rifiutati al salvataggio del provider (`400` da `POST`/`PATCH
/config/services`, un errore da `isitdown check`), come mezzo blocco OAuth o
`tokenEnv` insieme a un blocco OAuth. Una variabile non impostata al momento della
lettura fa fallire quella lettura col suo nome, invece di inviare un bearer vuoto
e dare il provider giù per un `401`. Nella dashboard i campi stanno sotto
**Avanzate → Credenziali**.

Microsoft 365 Service Health per un tenant, attraverso l'adapter JSON generico qui sopra
e una app registration con il permesso `ServiceHealth.Read.All`:

```yaml
services:
  - id: exchange-online
    name: Exchange Online
    adapter: json
    baseUrl: https://graph.microsoft.com/v1.0
    options:
      path: /admin/serviceAnnouncement/healthOverviews/Exchange%20Online
      statusPath: status
      statusMap: '{"serviceOperational":"operational","serviceRestored":"operational","investigating":"degraded","serviceDegradation":"degraded","restoringService":"partial_outage","extendedRecovery":"partial_outage","serviceInterruption":"major_outage"}'
      oauthTokenUrl: https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token
      oauthClientId: <application-id>
      oauthClientSecretEnv: M365_CLIENT_SECRET
      oauthScope: https://graph.microsoft.com/.default
```

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
| Pushover | `pushover` | `PUSHOVER_TOKEN`, `PUSHOVER_USER_KEY` (`PUSHOVER_DEVICE` opzionale) |
| Microsoft Teams | `teams` | `TEAMS_WEBHOOK_URL` |
| Matrix | `matrix` | `MATRIX_HOMESERVER_URL`, `MATRIX_ROOM_ID`, `MATRIX_ACCESS_TOKEN` |
| PagerDuty | `pagerduty` | `PAGERDUTY_ROUTING_KEY` (`PAGERDUTY_REGION` opzionale) |
| Opsgenie | `opsgenie` | `OPSGENIE_API_KEY` (`OPSGENIE_REGION` opzionale) |
| Apprise | `apprise` | `APPRISE_SERVER_URL`, e una fra `APPRISE_CONFIG_KEY` / `APPRISE_URLS` |
| Email (SMTP) | `email` | `SMTP_HOST`, `SMTP_FROM`, `SMTP_TO` (`SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_ALLOW_INSECURE_AUTH`, `SMTP_ALLOW_SELF_SIGNED` opzionali) |
| Splunk On-Call | `splunk-oncall` | `SPLUNK_ONCALL_API_KEY`, `SPLUNK_ONCALL_ROUTING_KEY` |
| Squadcast | `squadcast` | `SQUADCAST_WEBHOOK_URL` |
| Zenduty | `zenduty` | `ZENDUTY_INTEGRATION_KEY` |
| incident.io | `incident-io` | `INCIDENT_IO_ALERT_SOURCE_ID`, `INCIDENT_IO_TOKEN` |
| Grafana OnCall | `grafana-oncall` | `GRAFANA_ONCALL_WEBHOOK_URL` |
| Mattermost | `mattermost` | `MATTERMOST_URL`, `MATTERMOST_TOKEN`, `MATTERMOST_CHANNEL_ID` |
| Rocket.Chat | `rocketchat` | `ROCKETCHAT_URL`, `ROCKETCHAT_USER_ID`, `ROCKETCHAT_TOKEN`, `ROCKETCHAT_ROOM_ID` |
| Zulip | `zulip` | `ZULIP_SITE_URL`, `ZULIP_BOT_EMAIL`, `ZULIP_API_KEY`, `ZULIP_STREAM` (`ZULIP_TOPIC` opzionale) |
| Google Chat | `google-chat` | `GOOGLE_CHAT_WEBHOOK_URL` |
| SMS (Twilio) | `twilio-sms` | `TWILIO_SMS_ACCOUNT_SID`, `TWILIO_SMS_AUTH_TOKEN`, `TWILIO_SMS_FROM`, `TWILIO_SMS_TO` |
| Chiamata vocale (Twilio) | `twilio-call` | `TWILIO_CALL_ACCOUNT_SID`, `TWILIO_CALL_AUTH_TOKEN`, `TWILIO_CALL_FROM`, `TWILIO_CALL_TO` |
| Bark (iOS) | `bark` | `BARK_DEVICE_KEY` (`BARK_SERVER_URL` opzionale) |
| Signal | `signal` | `SIGNAL_API_URL`, `SIGNAL_NUMBER`, `SIGNAL_RECIPIENTS` |
| Syslog | `syslog` | `SYSLOG_URL` (`SYSLOG_FACILITY` opzionale) |
| MQTT | `mqtt` | `MQTT_BROKER_URL` (`MQTT_TOPIC`, `MQTT_USERNAME`, `MQTT_PASSWORD` opzionali) |
| Mastodon | `mastodon` | `MASTODON_INSTANCE_URL`, `MASTODON_ACCESS_TOKEN` (`MASTODON_VISIBILITY` opzionale) |
| Bluesky | `bluesky` | `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` (`BLUESKY_SERVICE_URL` opzionale) |
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

**Pushover** (roadmap 3.5) è la metà ospitata della stessa famiglia: due
credenziali — il token API dell'applicazione e la user key (o group key) — e una
sola POST form-encoded verso `api.pushover.net`. Entrambe viaggiano nel corpo e
non nella query string, perché un URL finisce nei log. L'intestazione è il
titolo della notifica, il dettaglio è il corpo, e la pagina di stato è il
bersaglio del tap invece di una riga di testo. La severità decide la priorità:
un outage parziale o totale esce a `1`, che scavalca le ore di silenzio del
destinatario; tutto il resto a `0`, e una lettura che non siamo riusciti a fare
a `-1`. La priorità `2` non viene usata di proposito — la priorità emergency
riallerta finché qualcuno non conferma, che è un'escalation di reperibilità e
non un cambio di stato. `PUSHOVER_DEVICE` restringe la consegna a un singolo
dispositivo registrato; se non è impostata la sentono tutti i dispositivi
dell'account.

**Microsoft Teams** (roadmap 3.8) è un solo incoming webhook, come Discord e
Slack, che porta una Adaptive Card. La card viaggia nella busta `attachments` e
non come il vecchio `MessageCard`: Microsoft ha ritirato i connettori di Office
365 in favore di Workflows, e un trigger di workflow capisce solo questa forma —
un connettore ancora vivo la renderizza comunque, quindi c'è un solo corpo invece
di un'impostazione che chiede all'operatore a quale epoca appartenga il suo
webhook. L'URL si crea nel canale con **Workflows → "Post to a channel when a
webhook request is received"**. La severità è il colore dell'intestazione,
nominato (`good` / `warning` / `attention`) invece che inviato come esadecimale,
così la card resta leggibile in entrambi i temi di Teams, e la stessa emoji che
mostra ogni altro canale lo ripete per un client che renderizza in monocromia.
La pagina di stato è un pulsante, non una riga di testo. L'URL è la credenziale,
quindi non compare mai in un errore.

**Matrix** (roadmap 3.6) pubblica in una stanza attraverso la client-server
API. Due formati viaggiano insieme, come Matrix si aspetta: `body` è il testo
semplice che mostra un client da terminale e `formatted_body` l'HTML che rende
un client grafico, costruiti dalle stesse parole, così nessuno dei due può dire
qualcosa che l'altro non dice. Un messaggio Matrix non ha un'affordance
separata per il link, quindi la pagina di stato è una riga finale nel testo e
un link nell'HTML — e il titolo dell'incident, che è del provider, viene
escapato prima di finire in quell'HTML invece che dato per buono.
`MATRIX_ROOM_ID` è l'id interno della stanza (`!ops:example.org`), non un
alias: un alias può essere ripuntato su un'altra stanza da chiunque ne abbia il
potere, e non è una proprietà che un canale di alert debba avere. Gli invii
sono `PUT` con un transaction id nuovo, la chiave di idempotenza di Matrix, così
una richiesta ritentata viene deduplicata dall'homeserver invece di pubblicare
l'alert due volte. La modifica è nativa: l'aggiornamento di un incident
riscrive il messaggio che aggiorna invece di aggiungerne un altro.

**PagerDuty e Opsgenie** (roadmap 3.7) sono la coppia on-call, e sono gli unici
canali che fanno più che consegnare un messaggio: qui un alert entra in una
catena di escalation, quindi deve anche richiudersi. Entrambi si appoggiano a
una chiave derivata dal cambiamento — il `dedup_key` di PagerDuty, l'`alias` di
Opsgenie, calcolati allo stesso modo — così la chiusura prodotta
dall'aggiornamento "resolved" del provider nomina proprio l'alert che il suo
"investigating" aveva aperto. Un incident si appoggia al proprio id, quindi un
provider con tre incident aperti tiene tre alert che si chiudono ciascuno per
conto suo; uno stato, un componente, una finestra di manutenzione e il nostro
stesso fetching si appoggiano a ciò di cui parlano, quindi uno stato che
peggiora due volte aggiorna un alert invece di impilarne altri. Che cosa
conti come chiusura è il ciclo di vita del diff engine, invariato: un incident
risolto, una finestra di manutenzione finita, uno stato tornato operativo. Un
digest non chiude mai nulla — il suo membro più grave sta per l'intero lotto, e
chiudere per un ritorno alla normalità che si è trovato a essere il peggiore di
cinque cambiamenti zittirebbe gli altri quattro.

La severità diventa la scala di ciascun servizio: `critical` / `error` /
`warning` / `info` per PagerDuty, `P1`–`P3` per Opsgenie. Imposta
`PAGERDUTY_REGION` o `OPSGENIE_REGION` a `eu` per un account provisionato in
Europa; non impostata significa l'istanza predefinita. Nessuna delle due
credenziali compare in una URL o in un errore — un invio rifiutato riporta lo
stato e il messaggio del servizio.

**Apprise** (roadmap 3.9) è un ponte più che un canale a sé: un notifier che
parla con un server API [Apprise](https://github.com/caronc/apprise), e
attraverso di lui con gli ~80 servizi che Apprise già sa raggiungere. È la
risposta pragmatica per una destinazione per cui questo progetto non scriverà
mai un notifier. Il costo è un servizio esterno, quindi non se ne dà nulla per
scontato: la URL del server è un'impostazione senza default, e un server giù
fa fallire la consegna come qualsiasi altro canale invece di perdere l'alert in
silenzio. Sono supportate due forme perché Apprise ne offre due — con
`APPRISE_CONFIG_KEY` è il server a tenere le URL dei servizi e IsItDown non le
vede mai, che è la sistemazione migliore visto che quelle URL sono credenziali;
con `APPRISE_URLS` viaggiano invece a ogni richiesta, per un server stateless.
Se sono impostate entrambe vince la configurazione salvata, perché è quella che
un operatore modifica. La severità sopravvive al ponte come tipo di notifica di
Apprise (`failure` / `warning` / `success` / `info`), e la pagina di stato è una
riga nel corpo: Apprise appiattisce qualunque affordance per il link abbia il
servizio a valle.

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

**Altre catene on-call** (roadmap 3.9). **Splunk On-Call** (VictorOps),
**Squadcast**, **Zenduty**, **incident.io** e **Grafana OnCall** funzionano
esattamente come PagerDuty e Opsgenie qui sopra: ognuno invia la stessa chiave
di deduplicazione — `entity_id` per Splunk, `event_id` per Squadcast,
`entity_id` per Zenduty, `deduplication_key` per incident.io, `alert_uid` per
Grafana — così il recupero prodotto dall'aggiornamento "resolved" del provider
chiude l'alert aperto dal suo "investigating", e un digest non chiude mai nulla.
La gravità diventa il vocabolario di ciascuno dove ne ha uno (`CRITICAL` /
`WARNING` / `INFO` per Splunk, `critical` / `error` / `warning` / `info` per
Zenduty); Squadcast, incident.io e Grafana portano lo stato come tag o campo di
metadati, che è ciò che leggono le loro regole di routing. La chiave o l'URL che
ognuno riceve è la credenziale, e nessuna compare mai in un errore.

**Mattermost, Rocket.Chat e Zulip** (roadmap 3.9) passano dall'API di ciascun
server con il token di un bot invece che da un webhook in entrata, per l'unica
cosa che un webhook non sa fare: modificare il messaggio che ha pubblicato. Gli
aggiornamenti di un incidente riscrivono il messaggio che lo ha annunciato, come
già fanno Telegram, Discord e Matrix. Il webhook compatibile Slack di Mattermost
funziona comunque attraverso il canale Slack, per chi non vuole un bot. Zulip
raggruppa ogni messaggio sotto un topic e, se `ZULIP_TOPIC` non ne indica uno,
ogni provider ha il suo: tutta la storia di GitHub si legge come un'unica
discussione. **Google Chat** è un webhook in entrata e non può modificare, quindi
usa i thread: ogni messaggio su un incidente porta la stessa chiave di thread e
arriva come risposta sotto quello che lo ha aperto.

**SMS e chiamate vocali con Twilio** (roadmap 3.9) sono due canali invece di uno
con una modalità, perché il routing è per canale: un SMS per ogni degrado e una
chiamata solo per un major outage sono due regole di routing. L'SMS è il
messaggio che manda ogni canale di solo testo, tagliato ai 1600 caratteri di
Twilio. La chiamata legge ad alta voce titolo e dettaglio nella lingua del
canale, due volte con una pausa in mezzo, come si leggono sempre le chiamate
automatiche; le emoji vengono tolte e le parole del provider sono sottoposte a
escape prima di finire nel TwiML. Il canale chiamata squilla per tutto ciò che
gli viene instradato, quindi va messo dietro una regola con `minSeverity:
major_outage`. Ogni canale ha le sue variabili, anche per lo stesso account: due
canali non condividono mai una variabile d'ambiente nella dashboard.

**Bark** (roadmap 3.9) è il push verso un iPhone attraverso il server Bark
pubblico o uno self-hosted. Ciò che lo rende un canale invece di un URL Apprise è
il livello di interruzione: un major outage parte come `critical`, che suona
anche in modalità silenziosa e con una modalità Full immersion attiva; un partial outage
come `timeSensitive`; una lettura che non siamo riusciti a fare come `passive`.
**Signal** passa da un server
[signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api), il
sidecar che usano tutti gli strumenti self-hosted visto che Signal non ha
un'API per bot. Le chiavi dell'account stanno sul server, quindi da questa parte
non c'è nessuna credenziale — e quel server non dovrebbe essere raggiungibile da
nessun altro punto.

**Syslog** (roadmap 3.9) invia un messaggio RFC 5424 per ogni cambiamento al
collector dove va già tutto il resto, via UDP, TCP o TLS (verificando il
certificato del collector). Il messaggio è una riga sola — titolo e dettaglio,
con gli a capo ripiegati — e la parte leggibile da una macchina viaggia come
structured data:

```
<130>1 2026-08-19T14:32:07.000Z host isitdown 1 incident_opened [isitdown@32473 provider="github" status="major_outage" key="isitdown/github/incident/inc-1" url="https://www.githubstatus.com"] 🔴 GitHub — MAJOR OUTAGE — Incident: API requests failing | Status: Investigating | …
```

`key` è la stessa chiave di deduplicazione dei canali on-call, così una regola
del SIEM può raggruppare i messaggi di un incidente. La gravità segue lo stato,
da `crit` per un major outage fino a `notice`. Un messaggio viene tagliato a 2048
byte su UDP e a 8192 su uno stream, cioè quanto ogni collector accetta di
default.

**MQTT** (roadmap 3.9) serve alla domotica che non è Home Assistant — Node-RED,
openHAB, un microcontrollore con una spia di stato. Ogni cambiamento è un
messaggio JSON su `<prefisso>/<provider>` (`provider`, `kind`, `status`,
`previous`, `heading`, `detail`, `url`, `at`), i digest su `<prefisso>/digest`.
Un cambiamento sullo stato del provider stesso — il suo stato, un incidente — è
pubblicato *retained*, così un subscriber che si collega più tardi sa comunque
dove si trova ogni provider; un componente, un avviso di manutenzione o il
nostro monitoraggio sono eventi e non sono retained, altrimenti
sovrascriverebbero quello stato. MQTT 3.1.1 è parlato direttamente su un
socket — connessione, una publish QoS 1, attesa della conferma del broker,
disconnessione — quindi il canale non aggiunge dipendenze all'immagine Light né
al binario singolo.

**Mastodon e Bluesky** (roadmap 3.9) pubblicano in pubblico: insieme alla pagina
di stato pubblica, sono l'account di stato che un piccolo team non ha mai
trovato il tempo di gestire a mano. Pubblico significa che le note di impatto e
responsabile dell'operatore ([3.23](#323-perché-un-provider-conta--impatto-e-responsabile))
non vengono mai pubblicate — sono note di passaggio di consegne, non roba per i
follower; un modello viene comunque pubblicato com'è scritto, perché ciò che
stampa è una scelta esplicita dell'operatore. Mastodon modifica il post quando
l'incidente che ha annunciato va avanti; Bluesky non permette modifiche, quindi
ogni cambiamento è un post. Bluesky vuole una app password, mai quella
dell'account.

**Cosa promette ogni canale** (roadmap 3.8). Un'unica contract suite,
`test/notifiers/contract.test.ts`, tiene ogni canale alle stesse proprietà: un
cambiamento di ogni tipo viene consegnato senza eccezioni; una consegna
rifiutata è un errore tipizzato che nomina il canale e lo stato HTTP e non
contiene mai una credenziale; ogni campo che il servizio remoto limita viene
tagliato per entrarci — i 1024 caratteri di Pushover, i 4096 di Telegram, i byte
di un datagramma syslog — con dei puntini di sospensione invece di essere
rifiutato con un 400, cosa che prima faceva perdere per intero un digest lungo;
la chiave di un canale on-call è stabile e condivisa dall'alert e dal suo
recupero; e i byte esatti che ogni canale mette in rete per un insieme fisso di
cambiamenti sono registrati in `test/notifiers/golden/`, così una modifica a ciò
che un canale invia è un diff che qualcuno ha rivisto.

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
Altri dodici controlli decidono *quanto* di quel cambiamento esce davvero, e in
quanti messaggi. Tutti sono disattivati per default, così
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
  maintenanceNotice:
    enabled: true
    leadMinutes: 120
  escalation:
    enabled: true
    afterMinutes: 15
    channel: pushover
    minSeverity: major_outage
  channelHealth:
    enabled: true
    afterFailures: 3
  incidentSummary:
    enabled: true
  coalesce:
    enabled: true
    windowMinutes: 2
  knownOutage:
    enabled: true
  attachChart: true          # solo edizione UI
  report:                    # solo edizione UI
    enabled: true
    frequency: weekly        # weekly | monthly
    channel: slack
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

**`maintenanceNotice`** avvisa *prima* che si apra una finestra di manutenzione
dichiarata dal provider, invece che solo quando parte — l'unico avviso che
permette di agire per primi ("manutenzione GitHub tra 2 h, durata prevista 30
min"). Una finestra viene annunciata una sola volta, alla prima lettura che la
trova entro `leadMinutes` dal suo inizio (1–10080, default 120), e viaggia come
classe di evento `maintenance`, quindi una regola che già porta la manutenzione
porta anche il preavviso. Un mute sul provider, o una finestra propria già in
corso, lo trattengono — senza consumarlo, così togliendo il mute l'avviso
arriva comunque. Una finestra senza fine dichiarata viene annunciata senza
durata. Come il riepilogo e il limite, ciò che è già stato annunciato vive in
memoria: un riavvio dentro l'anticipo ripete un preavviso invece di perderlo.

**`escalation`** ripete un cambiamento, su un canale diverso, quando nessuno l'ha
preso in carico. Uno stato che peggiora, un componente che peggiora, o un
incidente che si apre o evolve — pari o superiori a `minSeverity` (default
`major_outage`) — fa partire un conto alla rovescia nel momento in cui viene
inviato. Dopo `afterMinutes` (1–1440, default 15), se nessuno ha premuto **Preso
in carico** (o scritto `/ack`; vedi [3.17](configuration.it.md#317-chatops--comandare-il-bot-da-telegram)),
il provider è ancora in difficoltà e non è silenziato, lo stesso cambiamento viene
inviato una volta a `channel` — e solo a quello — con in coda "Nessuno l'ha preso
in carico dopo 15 min". Su Pushover non scende mai sotto la priorità alta. Vale
una volta per periodo di guai, non una per ogni aggiornamento successivo, e un
periodo finisce quando il provider è operativo senza nulla di aperto; un
ripristino, un mute o una presa in carico prima della scadenza lo annullano.
L'attesa si misura in cicli di polling, perché è quando il dispatcher viene
interpellato: un `afterMinutes` più corto della cadenza non è più corto della
cadenza. Se il canale di escalation è spento il log lo dice, invece di far
sparire il cambiamento nel nulla. I conti alla rovescia vivono in memoria come il
limite e il riepilogo, quindi un riavvio li azzera. **Solo edizione UI**:
l'edizione Light non ha nessuna presa in carico da leggere, quindi con
`escalation` attiva lì scrive una riga di log dicendo che nulla verrà escalato e
prosegue.

**`channelHealth`** avvisa gli altri canali quando uno smette di consegnare. Un
webhook che risponde 500 da una settimana altrimenti compare solo come badge
rosso nel registro consegne, e l'operatore deve accorgersi di un'assenza. Quando
un canale ha rifiutato `afterFailures` messaggi di fila (2–100, default 3) —
ognuno già oltre i propri tentativi, quindi una dead letter — gli altri canali
ricevono un messaggio: "IsItDown — il canale discord non funziona: 3 messaggi di
fila non sono arrivati, dal …, ultimo errore: HTTP 401". Viene instradato come
classe `monitoring` con le stesse regole di tutto il resto, togliendo il canale
rotto e ogni altro canale con una serie di fallimenti propria; se non resta
nessuno a cui dirlo, lo dice il log. Una volta per serie: l'avviso non si ripete
finché il canale resta rotto, e il primo messaggio che torna a consegnare chiude
la serie, così una rottura successiva viene segnalata di nuovo. Le ore di
silenzio lo trattengono come ogni altro cambiamento di monitoraggio, ed esce
dopo invece che mai. Il **Invia test** dell'operatore non conta. Le serie vivono
in memoria come il limite, quindi un riavvio le fa ripartire.

**`incidentSummary`** sostituisce i messaggi "risolto" di un guasto condiviso con
uno solo. Quando più provider peggiorano dentro la finestra di correlazione,
l'avviso lo dice già una volta (`correlationThreshold`); questa è la stessa
storia raccontata alla fine. Finché quel guasto è aperto, il rientro alla
normalità di ogni membro viene trattenuto, e quando l'ultimo è tornato un solo
messaggio dice "il guasto condiviso è finito: 6 provider coinvolti, 47 min in
tutto", con la causa probabile se i provider ne hanno dichiarata una con
`dependsOn`. Viene instradato e modificato sul posto come l'avviso che lo ha
aperto, e lo chiude su un canale di reperibilità. Un membro che peggiora di nuovo
prima che gli altri si riprendano non conta come rientrato, e uno che non si
riprende mai non trattiene gli altri per sempre: dopo sei ore il riepilogo esce
per i membri che si sono ripresi e gli altri vengono segnalati da soli. Il
guasto aperto vive in memoria, quindi dopo un riavvio ogni rientro viene
segnalato singolarmente.

**`coalesce`** invia solo l'ultimo di una serie di aggiornamenti dello stesso
incidente. Un provider che pubblica quattro aggiornamenti in dieci minuti produce
quattro messaggi, o quattro modifiche; con questa opzione un aggiornamento
aspetta `windowMinutes` (1–60, default 2) e viene sostituito da qualunque altro
più recente sullo stesso incidente, così esce lo stato in cui si trova
l'incidente, una volta sola. La finestra parte dal *primo* aggiornamento della
serie, quindi un provider che aggiorna ogni minuto produce comunque un messaggio
ogni `windowMinutes` invece di nessuno. L'apertura di un incidente non viene mai
trattenuta, e la sua risoluzione parte subito e annulla ogni aggiornamento ancora
in attesa. Ciò che aspetta viene giudicato da ore di silenzio, limite e riepilogo
quando viene rilasciato, non quando è arrivato; il rilascio avviene a un ciclo di
polling, quindi una finestra più corta della cadenza non è più corta. Gli
aggiornamenti trattenuti vivono in memoria, quindi un riavvio ne perde al più una
finestra, e disattivare l'opzione rilascia quanto era in attesa.

**`knownOutage`** evita che un'interruzione di cui sei già stato avvisato ti
chiami di nuovo a ogni aggiornamento. Finché un provider è in major outage, gli
ulteriori aggiornamenti del suo incidente vanno nella finestra del riepilogo
invece di uscire — che `digest` sia attivo o no — e arrivano come un solo
messaggio. Un cambio di stato (compreso quello verso o da major outage), la
risoluzione e un aggiornamento mentre il provider è sotto il major outage
interrompono comunque, come ogni incidente che segui.

**`attachChart`** aggiunge ai messaggi di stato e di incidente le ultime 24 ore
del provider come SVG — quarantotto celle da mezz'ora, ognuna grave quanto la
lettura peggiore al suo interno, grigia dove non si è letto nulla, ognuna con un
titolo così il colore non è mai l'unico veicolo. Disegna solo SVG, di proposito:
un rasterizzatore aggiungerebbe una dipendenza nativa a ogni immagine. Quindi
arriva solo ai canali che possono portarlo: **email** lo allega come
`<provider>-uptime-24h.svg`, e il **webhook** aggiunge al corpo un campo
`chart: { contentType, svg }`. Ogni altro canale invia il messaggio come ha
sempre fatto. Viene disegnato una volta per cambiamento, mai per un riepilogo,
un avviso di manutenzione, un report o un avviso di canale, e un errore nel
disegnarlo costa l'immagine e non l'avviso. **Solo edizione UI**: viene disegnato
dalle letture conservate.

**`report`** consegna la settimana o il mese della flotta su un solo `channel`,
invece di aspettare che qualcuno scarichi il report mensile: uptime della flotta,
i tre provider più deboli sotto il 100%, quanti incidenti, e il budget di errore
speso per ogni provider con uno `slaTarget`. `weekly` copre l'ultima settimana
completa da lunedì a domenica e `monthly` l'ultimo mese di calendario, entrambi
in UTC come ogni altro giorno dello storico; esce al primo polling dopo la
chiusura del periodo, una sola volta. Il budget di un report mensile è quello di
quel mese; in uno settimanale è quello del mese finora, la cifra su cui l'avviso
del budget di errore già avverte. Va al solo canale scelto — non è un avviso,
quindi regole di instradamento, limite e riepilogo non si applicano — ma aspetta
la fine delle ore di silenzio, ed esce dopo invece che mai. Attivarlo invia al
polling successivo il report dell'ultimo periodo chiuso. Un canale non abilitato
viene detto nel log. **Solo edizione UI**: legge lo storico conservato, quindi
l'edizione Light ignora il blocco.

**`onCall`** dice chi è di turno questa settimana, senza diventare un sistema
di reperibilità: PagerDuty e Opsgenie sono già canali e questo non li sostituisce.
È una rotazione di [destinatari](#321-destinatari--una-persona-più-canali) che
esistono già — uno a settimana, a turno, poi si ricomincia — e chi è di turno
riceve ogni cambiamento pari o sopra `minSeverity` (default `major_outage`) *in
più* di chi hanno già scelto le regole di instradamento. Aggiunge un lettore e non
ne toglie mai uno, quindi una rotazione sbagliata può solo notificare di troppo:
una che nomina un destinatario che nessuno ha definito perde il lettore in più,
non l'avviso, e lo dice nel log. Il destinatario è raggiunto come sempre — sul
canale preferito, passando al successivo solo se quello fallisce. Le settimane
vanno da lunedì a domenica, UTC; `startsOn` è un giorno qualsiasi della prima
settimana (vuoto conta dal 1970), e una data illeggibile conta allo stesso modo
invece di fermare un avviso. Non viene salvato nulla: chi è di turno è una
funzione della data, quindi un riavvio non cambia niente e la dashboard mostra lo
stesso nome che usa il dispatcher. Le ore di silenzio trattengono comunque prima
un cambiamento.

```yaml
delivery:
  onCall:
    enabled: true
    minSeverity: major_outage
    startsOn: 2026-10-05
    rotation: [alice, bob]   # id dei destinatari; la settimana 1 è di alice
```

**`deliveryTest`** è una notifica che dimostra che il sistema di notifica
funziona ancora, non solo il giorno in cui è stato configurato. Una volta a
settimana UTC ogni canale attivo riceve un messaggio che dice, nella lingua del
canale, che è il test settimanale di routine e che non c'è nessun problema; il
template di un canale non sostituisce quel testo. Ogni canale è provato per conto
suo, quindi un esito appartiene sempre a un solo canale. Un fallimento conta come
canale rotto subito — un solo test fallito è la prova a cui gli avvisi veri
arrivano con più fallimenti, perché con un messaggio a settimana ce ne
vorrebbe un mese per dirlo — e l'avviso esistente di
[`channelHealth`](#38-politica-di-consegna--ore-di-silenzio-riepiloghi-limiti)
avverte gli altri canali, se è attivo. Il test parte al primo poll della
settimana, aspetta la fine delle ore di silenzio e non viene ritentato.
**Solo edizione UI**: la settimana dell'ultima esecuzione sta nel database.

L'edizione Light configura il blocco `delivery` sopra (con le riserve appena
dette per `escalation`, `attachChart`, `report` e `deliveryTest`); l'edizione UI li modifica da
**Impostazioni → Consegna**, dove ogni riga si applica da sé e senza riavvio.

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

Un parco provider piatto risponde a "GitHub sta bene" e mai a "il mio percorso di deploy
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

### 3.11 Lingua e modello per canale

Due cose di un canale non riguardano il trasporto: in che lingua scrive
(roadmap 3.20) e come è impaginato il messaggio (roadmap 3.15). Entrambe sono
campi del canale stesso — `notifications.<canale>.locale` e
`notifications.<canale>.template` in `config.yml`, e il blocco **Messaggio** in
fondo alla riga del canale in **Impostazioni → Notifiche**.

```yaml
notifications:
  telegram:
    enabled: true
    botToken: "${TELEGRAM_BOT_TOKEN}"
    chatId: "${TELEGRAM_CHAT_ID}"
    # La chat legge in italiano; il webhook qui sotto resta in inglese.
    locale: it
  webhook:
    enabled: true
    url: "${WEBHOOK_URL}"
    template: |
      [{{severity}}] {{provider}} — {{title}}
      {{url}}
```

**La lingua** ricade sulla lingua di notifica dell'installazione (`locale:` in
cima al file, oppure **Impostazioni → Aspetto** nell'edizione UI), che è ciò che
ogni canale faceva prima che questo esistesse. È lo stesso catalogo che usa la
dashboard, quindi un canale può nominare solo una lingua che IsItDown ha davvero.

**Il modello** sostituisce la resa predefinita per quel canale. Non è
volutamente un linguaggio di template:

- **Solo sostituzione.** `{{provider}}` diventa una stringa. Niente `if`, niente
  cicli, niente filtri, nessuna espressione di alcun tipo.
- **Un segnaposto senza nulla dietro rende una stringa vuota**, e una riga fatta
  solo di segnaposti del genere viene eliminata invece di restare un'etichetta
  penzolante — così un modello scritto per gli incidenti resta leggibile su un
  cambio di stato che non ha nessun incidente dentro. Una riga con del testo
  letterale lo conserva: `Incidente: {{title}}` rende `Incidente:`.
- **Un segnaposto sconosciuto è rifiutato dove viene salvato**: l'edizione Light
  non parte e lo nomina, la dashboard risponde `400` con il segnaposto nel
  messaggio. Un refuso sopravvissuto si leggerebbe come `{{provder}}` a chi viene
  svegliato.
- **Un riepilogo non usa mai un modello.** Un modello descrive un cambiamento; un
  riepilogo è un gruppo di cambiamenti, e mantiene la propria resa.
- **La riga degli avvisi soppressi segue comunque il messaggio**, con o senza
  modello: riguarda ciò che l'operatore *non* si è sentito dire, non il
  cambiamento.

I segnaposti, che la dashboard elenca anche sotto il campo:

| Segnaposto | Che cos'è |
| --- | --- |
| `{{message}}` | L'intero messaggio predefinito, esattamente come il canale l'avrebbe inviato — il segnaposto che rende "il solito testo, con il nostro prefisso" un modello di una riga. |
| `{{emoji}}` | L'emoji della severità, quella con cui si apre il messaggio predefinito. |
| `{{provider}}` | Il nome visualizzato del provider. |
| `{{providerId}}` | L'id del provider, come configurato. |
| `{{kind}}` | Che cosa è successo, nella parola del diff engine: `incident_opened`, `status_change`, … |
| `{{severity}}` | La severità attuale, in maiuscolo — la parola del titolo. |
| `{{status}}` | La severità attuale, in forma normale. |
| `{{previous}}` | La severità prima di questo cambiamento; vuota se non c'era una lettura precedente. |
| `{{component}}` | Il componente che è cambiato; vuoto se non è un cambio di componente. |
| `{{title}}` | Il titolo dell'incidente o della finestra di manutenzione; vuoto se non c'è nessuno dei due. |
| `{{incidentStatus}}` | La parola di ciclo di vita del provider per l'incidente, tradotta dove è nota. |
| `{{impact}}` | Cosa si rompe quando questo provider va giù, come scritto sul provider ([3.23](#323-perché-un-provider-conta--impatto-e-responsabile)); vuoto se non impostato. |
| `{{owner}}` | Chi risponde di questo provider; vuoto se non impostato. |
| `{{url}}` | La pagina di stato pubblica del provider. Vuota su un canale che rende il link da sé (un embed Discord), così non viene mai stampato due volte. |
| `{{at}}` | Quando è successo, UTC. |

Tutto ciò che un segnaposto risolve viene dallo stesso catalogo con cui è
assemblato il messaggio predefinito, quindi un messaggio con modello e uno
predefinito dicono le stesse parole nella stessa lingua. Un modello le
riorganizza; non può inventarne di nuove.

### 3.12 Raggiungere l'API da un altro host

Ogni rotta dell'edizione UI è aperta, ed è la risposta giusta per il deployment
che questo progetto documenta: un container, legato a `127.0.0.1`, guardato da
chi lo gestisce. Smette di essere la risposta giusta nel momento in cui qualcosa
fuori da questa macchina deve leggerlo — un widget per una home page
([4.11](api.it.md)), un badge in un README, un job di scraping sulla macchina
accanto.

`API_TOKEN` è la cosa più piccola che sblocca questi casi (roadmap 4.15):

```yaml
services:
  isitdown-ui:
    environment:
      API_TOKEN: "una-stringa-lunga-e-casuale"
```

Quando è impostato:

- **Una richiesta che porta il token può leggere, da qualunque host.** `GET` e
  `HEAD` passano. Mandalo come `Authorization: Bearer <token>`, oppure come
  `X-API-Token: <token>` per un client il cui file di configurazione non ha
  spazio per uno schema.
- **Il token non concede nient'altro.** Qualunque altro metodo risponde `403`,
  a chi ha un token valido tanto quanto a chiunque altro — anche da questa
  macchina. Un token finisce incollato nella configurazione di una dashboard, in
  un cron, in un messaggio di chat; non deve mai valere più della lettura.
- **Tutto il resto deve comunque essere locale.** Una richiesta senza token
  viene servita solo se arriva da questa macchina, ed è ciò che tiene in
  funzione la dashboard stessa senza token nel browser.
- **`/health` e `/ready` non sono mai protette.** Una probe di Kubernetes arriva
  dall'indirizzo del nodo, non da loopback, e un controllo di liveness che
  comincia a fallire perché è stato impostato un token è un ciclo di riavvii.

Due cose da mettere in chiaro:

- **`X-Forwarded-For` viene ignorato.** Un header scritto dal client non può
  decidere se il client è locale. La conseguenza è che un reverse proxy che gira
  su questa stessa macchina fa sembrare locale ogni richiesta che inoltra —
  quindi dietro a uno imposta `API_LOCAL_BYPASS=false` e richiedi il token a
  tutti, questa macchina compresa.
- **Questa non è autenticazione.** Un token, nessuna identità, nessuna scadenza,
  e niente da revocare se non la variabile. È una porta con una chiave. L'auth
  multi-utente resta un non-obiettivo dichiarato.

```bash
curl -H "Authorization: Bearer $API_TOKEN" http://isitdown.lan:3000/widget
```

### 3.13 Obiettivi SLA e budget di errore

Una percentuale di uptime a 90 giorni risponde a "come è andato questo
fornitore". La domanda a cui bisogna rispondere in una revisione è "questo
fornitore rispetta ciò che ci era stato promesso, questo mese" — e serve un
numero che nessuno aveva scritto. `slaTarget` è quel numero (roadmap 4.13): una
percentuale di uptime mensile sul provider, in `config.yml` o nel campo
**Obiettivo di uptime mensile** della finestra di aggiunta/modifica.

```yaml
services:
  - name: GitHub
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com
    slaTarget: 99.9
```

Opzionale, e assente per impostazione predefinita: la maggior parte dei provider
è sorvegliata senza che nessuno abbia promesso nulla, e un valore predefinito
inventerebbe una promessa per poi misurarla. Tra 50 e 100.

Con un obiettivo impostato, l'edizione UI calcola quattro cose per il mese
solare in corso — un mese, perché è l'unità in cui uno SLA è scritto — dagli
stessi campioni salvati da cui è disegnata la vista Cronologia:

- **Il budget.** Lo 0,1% di un mese da 31 giorni sono 44,6 minuti di disservizio.
- **Quanto è speso.** Il disservizio misurato finora, con la stessa aritmetica
  sul numero di campioni che usa già la cifra di downtime della Cronologia.
- **Il ritmo di consumo.** La spesa rapportata al tempo *trascorso*: `1` è
  esattamente in budget, `2` è spenderlo al doppio della velocità che il mese si
  può permettere. È il numero che vale la pena leggere su una dashboard, perché
  "13 minuti su 44" richiede che il lettore sappia che giorno è, e questo no.
- **La proiezione.** Il ritmo misurato portato fino a fine mese. Volutamente
  nulla di più sofisticato: una stima pesata sarebbe una previsione, e una
  previsione sbagliata sul mese di un fornitore è peggio di nessuna previsione.

Compare come scheda **Budget di errore** nella pagina del provider, e per tutta
la flotta è `GET /sla`.

**L'avviso.** Quando la proiezione scende sotto l'obiettivo per la prima volta,
il provider riceve una notifica `sla_burn` — attraverso il motore di diff e il
dispatcher come ogni altro avviso, quindi valgono le regole di instradamento, le
ore di silenzio, la finestra di riepilogo e il limite orario. Tre cose:

- È instradato come evento di **monitoraggio**, non di stato. Quando scatta,
  nulla del provider è cambiato; è un'affermazione su un mese di misurazioni, e
  una regola che esiste per svegliare qualcuno durante un disservizio non deve
  essere svegliata da un'aritmetica.
- È detto **una volta per provider per mese**, e il segnaposto sta nel database
  invece che in memoria: un riavvio il 12 non deve ripeterlo.
- Non dice nulla finché non sono state misurate almeno sei ore di quel mese.
  Un'ora storta il giorno 1 proietta un mese perduto, e il giorno 3 non lo è più.

Un mese che non contiene campioni riporta `null` invece di 0%: non aver misurato
nulla non è un fornitore che era giù, e l'intero servizio di cronologia si regge
già su questa distinzione.

### 3.14 Plugin adapter

Un provider con una pagina di stato inusuale richiede un adapter, un adapter
richiede una pull request, e chi vuole sorvegliare un solo servizio interno non
dovrebbe dover forkare uno strumento di monitoraggio per farlo. `PLUGINS_DIR` è
la risposta (roadmap 1.13): puntalo a una cartella e ogni file `.js`, `.mjs` e
`.cjs` al suo interno viene caricato all'avvio e registrato come adapter.

```yaml
services:
  isitdown-ui:
    environment:
      PLUGINS_DIR: /plugins
    volumes:
      - ./plugins:/plugins:ro
```

Un plugin è un modulo il cui export di default è un adapter — la stessa forma
che implementano quelli integrati:

```js
// plugins/acme.js
export default {
  // Uno slug minuscolo, e non uno già usato da un adapter integrato. È ciò che
  // `adapter:` nomina in config.yml, o ciò che accetta il campo adapter della
  // dashboard.
  id: "acme",

  // Lancia su errore di rete, risposta non 2xx o corpo non interpretabile;
  // degrada in silenzio su un singolo campo mancante. `ctx.timeoutMs` è il
  // timeout di richiesta configurato.
  async fetchStatus(service, ctx) {
    const response = await fetch(`${service.baseUrl}/health.json`, {
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    if (!response.ok) throw new Error(`acme: HTTP ${response.status}`);
    const body = await response.json();
    return {
      provider: service.id,
      // Uno tra: operational, degraded, partial_outage, major_outage, unknown.
      overallStatus: body.ok ? "operational" : "major_outage",
      activeIncidents: [],
      components: [],
      maintenances: [],
      fetchedAt: new Date().toISOString(),
    };
  },
};
```

`fetchIncidentHistory` e `listComponents` sono opzionali; un adapter che non li
ha semplicemente non ha una cronologia recuperabile e non offre il selettore dei
componenti. Funziona anche un export chiamato `adapter` al posto di quello di
default, per un file che esporta anche funzioni sue.

> **Un plugin è codice arbitrario che gira dentro il poller**, con i suoi
> privilegi e il suo accesso a ogni credenziale di canale che la configurazione
> ha risolto. Non c'è nessuna sandbox, e non ci sarà: Node non ha un confine
> in-process degno di questo nome, e uno finto sarebbe peggio di un'assenza
> onesta. Per questo nulla imposta `PLUGINS_DIR` al posto tuo — né le immagini né
> il file compose — e per questo ogni plugin caricato viene annunciato nel log
> con il file da cui proviene. Tratta un plugin esattamente come tratteresti una
> patch a questo codice, perché è quello che è.

Tre regole che il loader applica, tutte perché un file sbagliato non costi alla
flotta il suo monitoraggio:

- **Un plugin non può prendere un id che esiste già** — né quello di un adapter
  integrato né quello di un altro plugin. Sovrascrivere `statuspage` cambierebbe
  ciò che legge ogni provider esistente, e due plugin in corsa per lo stesso id
  renderebbero il comportamento dipendente dai nomi dei file. Il file viene
  rifiutato e nominato.
- **Un file che non si importa, o che esporta qualcosa che non è un adapter,
  viene saltato e nominato** — il resto della cartella si carica lo stesso.
- **Una cartella mancante è un avviso, non un errore.** Impostare la variabile
  prima di montare il volume ti dà una riga nel log e un poller che gira.

`node dist/light/check.js` carica i plugin prima di validare il file, così un
`config.yml` che nomina l'adapter di un plugin risulta valido, e un plugin che
non si è potuto caricare è uno degli errori che riporta.

### 3.15 Push del provider invece del polling

Atlassian Statuspage permette a chi si iscrive di registrare un URL e ci invia
una POST a ogni cambiamento. Dove quell'URL è raggiungibile, la latenza di un
cambio di stato passa da una cadenza a pochi secondi, e un provider tranquillo
smette del tutto di essere letto a timer (roadmap 2.10).

Imposta `PUSH_TOKEN` sull'edizione UI e registra l'URL sulla pagina del provider
(**Subscribe → Webhook**, sulla maggior parte delle istanze Statuspage):

```
https://isitdown.example.com/push/github?token=<PUSH_TOKEN>
```

Non serve comporre quell'indirizzo a mano. La pagina di ogni provider Statuspage
nella dashboard ha una scheda **Push dal provider** (roadmap 1.2): con
`PUSH_TOKEN` non impostato spiega come attivare il push; una volta impostato
mostra l'indirizzo da incollare, con un bottone per copiarlo e i passaggi per la
pagina di quel provider. Quando la dashboard è aperta su `localhost` la scheda
avvisa che Statuspage non può raggiungere quell'host — va sostituito con
l'indirizzo pubblico di IsItDown, stesso percorso. Il token completo è visibile
solo sulla dashboard dell'operatore; chi usa un `API_TOKEN` in sola lettura vede
`<PUSH_TOKEN>` al suo posto.

Statuspage non manda eventi di prova, quindi la scheda non può verificare
un'iscrizione nel momento in cui viene fatta. Fa la cosa onesta: registra ogni
post che arriva — nel database, così sopravvive a un riavvio — e passa a
**Funziona**, con l'ora dell'ultimo post, al prossimo aggiornamento reale del
provider.

**Ciò che arriva è un innesco, non una lettura.** È la decisione di progetto che
vale la pena conoscere. IsItDown non interpreta il corpo del webhook per
ricavarne uno stato: legge il provider, in quel momento, attraverso l'adapter che
già sa come farlo. Tutto ciò che viene dopo — il motore di diff, lo smorzamento
dei rimbalzi, l'instradamento, le ore di silenzio, il registro di consegna — è lo
stesso codice che esegue un ciclo programmato. L'alternativa, interpretare
direttamente il payload, significherebbe due modi di conoscere lo stato di un
provider, due parser da tenere al passo con Statuspage e due occasioni perché un
incidente arrivato via push abbia una forma diversa da uno letto col polling. Il
costo di farlo così è una richiesta HTTP per evento invece di zero, che sono
comunque molte meno di una per cadenza per sempre.

**Il polling resta la rete di sicurezza.** Un push è un'aggiunta, mai una
sostituzione. La pianificazione continua a girare e questa rotta non la ritarda,
quindi un'installazione casalinga senza URL raggiungibile dall'esterno — il
motivo per cui questa non può essere l'unica strada — si comporta esattamente
come oggi. Un'istanza *raggiungibile* può allungare l'`intervalMinutes` di quel
provider per rendere la pianificazione una rete di sicurezza invece della strada
principale.

Tre cose sull'endpoint:

- **L'URL è la credenziale.** Statuspage non manda firme né header
  personalizzati, quindi non c'è altro a disposizione. Tratta l'URL come un
  segreto, ruotalo cambiando `PUSH_TOKEN` e servilo su HTTPS. Il token è
  confrontato a tempo costante, e uno sbagliato è un `401` con una riga nel log.
- **È l'unica rotta che il token API di sola lettura non protegge**
  ([3.12](#312-raggiungere-lapi-da-un-altro-host)). Chi la chiama è un provider,
  non un operatore: non gli si può dare un bearer token, ed è una `POST`, che
  quel token rifiuta per principio. Porta invece la propria credenziale.
- **Più POST per un solo cambiamento costano una sola lettura.** Statuspage
  invia l'incidente e poi ogni componente coinvolto nel giro di pochi secondi;
  qualunque cosa arrivi entro dieci secondi da un push accolto riceve
  `202 coalesced`.

Un id di provider che nessuno sta sorvegliando, o disabilitato, è un `404` — che
è anche la risposta quando `PUSH_TOKEN` non è impostata, così un'istanza che non
ha aderito non fa sapere che la funzione esiste.

### 3.16 Tracce

Punta `OTEL_EXPORTER_OTLP_ENDPOINT` a un collector e IsItDown esporta tracce
OpenTelemetry (roadmap 6.10):

```yaml
services:
  isitdown-ui:
    environment:
      OTEL_EXPORTER_OTLP_ENDPOINT: http://tempo:4318
      OTEL_SERVICE_NAME: isitdown
```

Tre span, ed è tutta la strumentazione:

| Span | Che cosa copre |
| --- | --- |
| `poll.cycle` | Un ciclo da capo a fondo — il caricamento della configurazione, la lettura di ogni provider e l'invio che ne segue. `isitdown.manual` dice se è partito dal pulsante **Interroga ora**, `isitdown.narrowed` se era un solo provider che rispondeva a un push ([3.15](#315-push-del-provider-invece-del-polling)). |
| `provider.read` | Un provider, compresa l'attesa di sfasamento prima della sua richiesta — perché una lettura durata quattordici secondi deve rendere conto anche dei secondi passati ad aspettare di proposito. Porta `isitdown.provider` e `isitdown.adapter`. |
| `notification.send` | Un messaggio verso un canale, ritentativi compresi: "quanto è servito per avvisare qualcuno" è una risposta sola, non tre. Porta `isitdown.channel`, `isitdown.provider` e `isitdown.kind`. |

Uno span il cui lavoro solleva un'eccezione viene esportato con l'errore sopra e
l'errore viene rilanciato — così la traccia mostra la lettura fallita e il poller
gestisce il fallimento esattamente come ha sempre fatto.

**La riga di roadmap che chiedeva questa funzione diceva "probabilmente no", e il
motivo erano le dipendenze**: il modo consueto di ottenere le tracce è un SDK con
le sue trenta dipendenze transitive, in un progetto il cui punto di forza è
averne tre e poterle leggere tutte. Perciò questa funzione arriva **senza
nessuna nuova dipendenza**. OTLP su HTTP è un documento JSON inviato in POST a
`/v1/traces`, ed è esattamente ciò che costruisce `src/core/tracing.ts` — niente
auto-strumentazione, niente `fetch` modificata, nessun vendor. Qualunque
collector che parli OTLP/HTTP (Tempo, Jaeger, l'OTel Collector, uno gestito) lo
legge.

La metà onesta del compromesso:

- **Esistono solo i tre span qui sopra.** Non ci sono span HTTP o SQLite
  automatici sotto di essi. Sono esattamente la domanda posta dalla riga di
  roadmap — dove sia finito un ciclo lento — e nulla di più.
- **Nessun segnale di metriche né di log.** `/metrics` è già migliore per il
  primo e il logger è già strutturato per il secondo.
- **Nessun campionamento e nessun ritentativo.** Gli span si accodano fino a un
  massimo di 2048 e oltre quello vengono scartati a partire dai più vecchi; un
  export fallito è un avviso, detto una volta per guasto, e quegli span sono
  persi. La telemetria non deve mai poter far cadere il monitoraggio.

Il tracing è spento se non è impostata una delle due variabili di endpoint, e da
spento non costa nulla: ogni punto di chiamata tiene un oggetto i cui metodi
ritornano immediatamente.


### 3.17 Chatops — comandare il bot da Telegram

Il canale Telegram può accettare comandi oltre a inviare avvisi. Solo edizione
UI, e spento se non lo chiedi:

```bash
TELEGRAM_CHATOPS=true
```

Il bot risponde allora nella chat in cui già avvisa:

| Comando | Cosa fa |
|---|---|
| `/status` | Tutti i provider attivi, i peggiori per primi, con incidenti aperti ed eventuale silenziamento in corso. |
| `/status <provider>` | Un solo provider, più il suo uptime a 90 giorni. |
| `/history <provider> [7\|30\|90]` | Uptime su un periodo, i giorni davvero misurati, gli incidenti e la giornata peggiore. Default 30. |
| `/mute <provider> <30m\|2h\|1d>` | Sospende gli avvisi per un po', fino a `30d`. |
| `/unmute <provider>` | Li riattiva. |
| `/ack <provider>` | Dice che ci stai lavorando: registra chi ha preso in carico il guaio in corso del provider. |
| `/help` | L'elenco qui sopra. |

**Bottoni sull'avviso stesso.** Finché il chatops è attivo, un avviso Telegram
su un guaio ancora in corso — uno stato che peggiora, un incidente che si apre o
evolve — porta due bottoni sotto di sé: **Preso in carico** e **Silenzia 2h**.
Sono i comandi `/ack` e `/mute … 2h` senza doverli digitare, serviti dallo stesso
codice, autorizzati dalla stessa lista di chat e scritti nella lingua del canale.
Premere **Preso in carico** scrive in chat chi se n'è occupato, così il resto del
gruppo lo vede; vince la prima pressione, e una seconda dice chi è arrivato
prima. Un ripristino, un avviso di manutenzione, una pagina lenta o un riepilogo
non hanno bottoni — non c'è nulla da prendere in carico — e il messaggio che
chiude un incidente perde quelli che aveva. Un id di provider troppo lungo per i
64 byte che Telegram concede ai dati di un bottone fa partire l'avviso senza
bottoni, invece di un bottone per il provider sbagliato.

Le notifiche **web push** ricevono le stesse due azioni quando il browser le
mostra. Chiamano `POST /providers/:id/ack` e `POST /providers/:id/mute` su questo
server, le stesse route in cui finiscono i bottoni Telegram. Se la chiamata fallisce
— la dashboard non è raggiungibile, o un token API rifiuta la scrittura — il clic
apre la dashboard invece di fallire in silenzio, perché un bottone che non fa
nulla e non dice nulla ti lascerebbe credere di aver preso in carico.

Una presa in carico è per provider, non per incidente, e si scioglie da sola
quando il provider è operativo senza nulla di aperto. Non fa parte di un backup.

Un provider si può indicare con l'id configurato o con il nome che compare sulla
dashboard, quello che viene in mente per primo. Un mute impostato qui è lo
*stesso* mute della dashboard: è scritto dove lo legge il diff engine, quindi si
vede a schermo e scade da solo.

**Chi può comandarlo.** Le chat che hai configurato, e nessun altro. L'elenco è
la chat a cui il canale Telegram già invia, più quanto c'è in
`TELEGRAM_COMMAND_CHAT_IDS`. Un messaggio da qualsiasi altra chat viene ignorato
in silenzio — non rifiutato, perché un rifiuto conferma che il bot esiste a
chiunque stia sondando. Non c'è nessuna procedura di iscrizione e nessuna
password, di proposito: un segreto scritto in una chat per ottenere l'accesso a
quella chat non protegge nulla.

Usa il long polling invece di un webhook, così funziona da dietro un router senza
porte aperte — la stessa ipotesi su cui è costruito tutto il resto di IsItDown.

L'edizione Light non ha chatops, perché `/mute` significherebbe che questo
processo riscrive il tuo `config.yml` alle tue spalle. Leggerlo dal database
dell'edizione UI è invece una porta su una stanza che esiste già.

### 3.18 La pagina di stato pubblica

Una pagina in sola lettura, costruita sulla flotta che già controlli, per
persone che non sono l'operatore: «ecco lo stato di salute di tutto ciò da cui
dipendiamo». Spenta finché non la accendi:

```bash
PUBLIC_PAGE=true
PUBLIC_PAGE_TITLE="Stato Acme"
PUBLIC_PAGE_PROVIDERS=github,cloudflare,stripe   # facoltativa; vuota li pubblica tutti
```

Serve due cose e nient'altro:

- **`GET /public`** — una pagina HTML autosufficiente: una fascia di riepilogo e
  poi una scheda per provider con la solita striscia giornaliera a 90 giorni, i
  suoi incidenti aperti ed eventuali manutenzioni in corso.
- **`GET /public/summary.json`** — esattamente la stessa proiezione in JSON,
  aperta via CORS, per chi vuole costruirci sopra una vista propria.

Entrambe sono in cache per un minuto, e nessuna delle due legge un parametro di
query, un header o un corpo. Non c'è alcun input nella richiesta, quindi un
visitatore non può chiedere di vedere un provider che hai scelto di non
pubblicare.

**Cosa non può far uscire, di proposito.** L'oggetto pubblicato è scritto campo
per campo in `src/ui/publicPage.ts` invece di essere filtrato dal payload della
dashboard: un payload filtrato lascerebbe passare il prossimo campo che qualcuno
gli aggiunge. Così niente su adattatori, canali, regole di instradamento, mute,
conteggi di errore o credenziali ha una riga lì, e la pagina non porta **nessun
JavaScript**: non può chiamare l'API della dashboard perché non c'è nulla, sopra,
che possa chiamare qualcosa. Il che significa anche che si disegna comunque
durante il guasto che esiste per raccontare.

Un caso vale la pena conoscerlo. Il link di un provider punta alla pagina di
stato del fornitore, che è pubblica per definizione — ma per gli adattatori
`http`, `tcp`, `dns`, `uptimekuma` e `imap` l'URL base è *tuo*, un hostname interno.
Quei provider compaiono lo stesso, con il nome che hai dato loro, ma senza link.

Non è autenticazione: chiunque raggiunga la porta può leggere la pagina, ed è
proprio il punto. Imposta `API_TOKEN` e la pagina resta aperta mentre la
dashboard no — chi la legge è esattamente chi non ha nessun token.

### 3.19 Heartbeat — il dead-man's switch

Ogni altro provider è qualcosa a cui IsItDown va a chiedere. Un `heartbeat` è
interrogato *da* altri: un cron job chiama un URL quando ha finito, e l'allarme
è la chiamata che non arriva — il backup che ha smesso di girare tre settimane
fa (roadmap 2.5). Solo edizione UI: l'edizione Light non ha un URL che un job
possa chiamare, e rifiuta un provider `heartbeat` nel suo `config.yml` come
adapter sconosciuto.

```json
{
  "id": "nightly-backup",
  "name": "Nightly backup",
  "adapter": "heartbeat",
  "baseUrl": "https://heartbeat.invalid",
  "options": { "every": "24h", "grace": "1h" }
}
```

| Opzione | Significato |
|---|---|
| `every` | Obbligatoria. Ogni quanto chiama il job, da un ping al successivo: `30m`, `24h`, `7d` — un numero e un'unità (`s`, `m`, `h`, `d`), tra `1m` e `35d`. Un numero senza unità viene rifiutato invece che letto in un'unità qualsiasi. |
| `grace` | Quanto può tardare un ping prima di essere considerato mancato. Di default un decimo di `every`, mai meno di un minuto; mai più lungo di `every`. |

`baseUrl` non viene letto. Per convenzione è `https://heartbeat.invalid` — un
dominio riservato per non risolversi mai — ed è quello che scrive
`isitdown import`.

Imposta `HEARTBEAT_TOKEN` e dai al job il suo URL — l'ultima riga di un crontab:

```bash
0 3 * * * /usr/local/bin/backup.sh && curl -fsS "https://isitdown.example.com/heartbeat/nightly-backup?token=$HEARTBEAT_TOKEN"
```

Valgono sia `GET` sia `POST`. Il provider resta `operational` finché dall'ultimo
ping non sono trascorsi `every` più `grace`, e da lì in poi è `major_outage` — il
verdetto passa dal diff engine e dal routing come qualsiasi outage, quindi
un'esecuzione mancata notifica sugli stessi canali e con le stesse regole. Un
job che non ha mai chiamato si misura da quando il monitor è stato letto la
prima volta: è in ritardo dopo il primo periodo, non in attesa per sempre. Un
ping legge anche subito il provider, così un job in ritardo che finalmente
chiama si risolve in pochi secondi; i ping a meno di dieci secondi l'uno
dall'altro vengono registrati senza un'altra lettura (`202`).

`GET /config/heartbeats` elenca l'URL di ogni heartbeat con l'ultima chiamata
del suo job e quante ne ha ricevute — l'unica prova che una riga di crontab sia
giusta. Il token compare solo per una richiesta che potrebbe anche scrivere; chi
ha un `API_TOKEN` in sola lettura vede `<HEARTBEAT_TOKEN>` al suo posto. Come
l'URL di push ([3.15](#315-push-del-provider-invece-del-polling)), la rotta del
ping non è mai protetta da `API_TOKEN` — chi chiama è uno script — quindi tratta
l'URL come il segreto che è e servilo in HTTPS. Un ping che arriva mentre
l'istanza stessa è giù va perso: il successivo rimette a posto il provider.

### 3.20 Dipendenze — "su cosa gira"

Metà di una flotta gira sull'altra metà: Vercel su AWS, mille prodotti SaaS su
Cloudflare. Quando più provider peggiorano insieme, l'avviso di guasto condiviso
([`correlationThreshold`](#31-edizione-light--configyml)) dice *che* è successo.
Una lista `dependsOn` è il modo in cui l'operatore gli dice *perché* (roadmap
2.9) — in `config.yml`:

```yaml
services:
  - name: Vercel
    id: vercel
    adapter: statuspage
    baseUrl: https://www.vercel-status.com
    dependsOn: [cloudflare]
  - name: Linear
    id: linear
    adapter: statuspage
    baseUrl: https://linearstatus.com
    dependsOn: [cloudflare]
```

Quando due o più provider di un guasto condiviso nominano lo stesso upstream, il
messaggio guadagna una riga — "Causa probabile: cloudflare" — e così la voce del
digest. Nell'edizione UI il campo è `dependsOn` su `POST /config/services` e
`PATCH /config/services/:id` (`null` lo azzera); la dashboard lo modifica nella riga
**Dipende da** del form del provider. Finché due provider abilitati che nominano
lo stesso upstream sono in difficoltà o giù, la Overview disegna una scheda
*Guasto condiviso* — l'upstream al centro, i dipendenti intorno — che sparisce
appena uno dei due si riprende. La scheda *Cadono insieme* della vista Storico
(roadmap 2.10, `GET /coincidence`) propone le coppie che continuano a cadere
insieme; **Dichiara dipendenza** scrive lo stesso `dependsOn`, **Nascondi**
nasconde la coppia solo su quel browser.

- **Dichiarata, mai dedotta.** IsItDown non indovina un grafo dai guasti: una
  coincidenza verrebbe chiamata causa.
- **Solo le parole.** Non fa partire una correlazione che la finestra non ha
  trovato, e un provider che nomina un upstream che nessun altro nomina non
  cambia nulla.
- **L'upstream non deve essere monitorato qui.** Nomina un cloud da cui dipendi
  soltanto e viene comunque indicato come causa. Lo slug non è verificato
  contro la flotta.
- **A parità di voti** vince l'id che viene prima in ordine alfabetico, così la
  stessa finestra nomina sempre la stessa causa.

### 3.21 Destinatari — una persona, più canali

Chi è sia su Telegram sia su Discord riceve ogni avviso due volte, quindi ne
silenzia uno — e perde la ridondanza per cui il secondo canale c'era. Un
*destinatario* raggruppa i canali che raggiungono la stessa persona (o lo stesso
team), in ordine di preferenza: un cambiamento va al primo, e al successivo solo
quando quello è fallito del tutto, tentativi esauriti.

```yaml
recipients:
  - id: alice
    name: Alice
    channels: [telegram, discord]   # prima il preferito, poi le riserve in ordine
```

- **Le regole decidono ancora chi può saperlo.** Un destinatario decide solo
  quante volte. Un cambiamento raggiunge i canali del destinatario *che la sua
  regola ha raggiunto*, nell'ordine del destinatario — così una regola che tiene
  un provider fuori da Discord lo tiene fuori anche dalla riserva Discord.
- **Si registrano entrambi i lati.** Un ripiego scrive nel registro consegne il
  fallimento del canale preferito e la consegna della riserva, così il registro
  mostra ancora il canale che ne ha avuto bisogno, e
  [`channelHealth`](#38-politica-di-consegna--ore-di-silenzio-riepiloghi-limiti)
  conta comunque quel fallimento.
- **Un riepilogo** va al canale preferito del destinatario, ripiegando allo
  stesso modo quando la sua finestra si chiude.
- **Le regole della lista**: almeno due canali ciascuno, un canale in al massimo
  un destinatario, e ogni canale uno che la configurazione definisce —
  l'edizione Light rifiuta di partire con un destinatario che nomina un canale
  assente da `notifications`, come fa per una regola di instradamento.

L'edizione Light li configura con la lista `recipients` sopra; l'edizione UI li
modifica da **Impostazioni → Notifiche → Destinatari**, salvati tutti insieme
(`PUT /config/recipients`). Export e import li trasportano; il web push non ha
posto in un `config.yml`, quindi resta fuori da un destinatario esportato.

### 3.22 Seguire un singolo incidente

Il provider che di solito tieni lontano dal telefono può avere proprio
l'incidente di cui vuoi sentire ogni parola. **Segui** sulla pagina di un
incidente aperto manda ogni aggiornamento successivo di quell'incidente a ogni
canale attivo finché non si risolve, senza toccare una regola di
instradamento; la risoluzione è l'ultimo messaggio, e il seguito finisce con
lei. Riguarda solo quell'incidente — gli altri cambiamenti del provider vanno
ancora dove li mandano le regole. Le ore di silenzio valgono comunque: seguire
dice "dimmi ogni aggiornamento", non "svegliami per ogni aggiornamento". I
destinatari ([3.21](#321-destinatari--una-persona-più-canali)) si raggruppano
comunque, così una persona con due canali sente ogni aggiornamento una volta.

**Solo edizione UI** — l'edizione Light non ha una pagina su cui premerlo. Le
route sono `PUT` e `DELETE /incidents/:providerId/:incidentId/follow`; un
incidente risolto non si può seguire (409). Un seguito non fa parte del backup,
per lo stesso motivo di una presa in carico: ripristinato, manderebbe a ogni
canale aggiornamenti su un incidente che nessuno guarda più.

### 3.23 Perché un provider conta — impatto e responsabile

Alle 3 di notte "GitHub — MAJOR OUTAGE" è una parola di stato; "deploy bloccati,
CI ferma — chiedi a @alice" è una nota di passaggio di consegne. Due campi
facoltativi sul provider dicono questo:

```yaml
services:
  - name: GitHub
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com
    impact: deploy bloccati, CI ferma   # fino a 200 caratteri
    owner: "@alice"                     # fino a 80 caratteri
```

Entrambi vengono aggiunti sotto ogni messaggio su quel provider — "Impatto: …" e
"Responsabile: …", nella lingua del canale — e mostrati sulla sua pagina nella
dashboard. Un canale con un modello ([3.11](#311-lingua-e-modello-per-canale))
li colloca da sé con `{{impact}}` e `{{owner}}`, così non vengono aggiunti due
volte. Un riepilogo, che parla di più provider, e un avviso di canale rotto, che
nomina un provider solo perché il messaggio perso parlava di lui, non portano
nessuno dei due. Nell'edizione UI sono i campi **Perché conta** e
**Responsabile** del modulo del provider, e `impact` / `owner` su
`POST /config/services` e `PATCH /config/services/:id` (`null` cancella l'uno o
l'altro).

