[← README](../README.it.md)

## 6. API HTTP

Solo edizione UI. Ogni risposta è JSON, errori compresi
(`{ "error": { "message": "..." } }`): una fetch dal browser che si ritrova una pagina
HTML di errore segnala un errore di parsing invece del problema vero.

| Metodo | Percorso | Scopo |
|---|---|---|
| `GET` | `/health` | Liveness, e nient'altro: il processo risponde. `{ status, providers, lastCycleAt }`. Non fallisce mai perché un provider è irraggiungibile. |
| `GET` | `/ready` | Readiness: se il polling sta funzionando. `200` con `{ status: "ready", providers, failed, lastCycleAt, ageSeconds, staleAfterSeconds }`, oppure `503` con la stessa forma più `reason` — nessun ciclo è ancora andato a termine, l'ultimo è più vecchio di tre intervalli di polling, o in esso ogni provider ha fallito. È ciò che interroga l'healthcheck del container. |
| `GET` | `/status` | Stato corrente di ogni provider, più ultimo e prossimo poll, più `maintenance: { active, upcoming }` — le finestre in corso adesso e quelle il cui `startsAt` è ancora nel futuro; una finestra già terminata ma ancora presente nel payload salvato non compare in nessuna delle due liste. Pura lettura dal database — si può interrogare ogni 30s, come fa la dashboard. Non raggiunge mai l'upstream. Porta anche `groups` — una voce per gruppo di provider con lo stato derivato, i membri e i membri colpiti (roadmap 2.6, §3.10). |
| `GET` | `/history/calendar?provider=` | Un anno di celle giornaliere per un provider — roadmap 5.20. `{ providerId, days, cells: [{ day, status, uptime }], uptime, measuredDays }`, dalla più vecchia, con i buchi riempiti: un giorno non campionato è `unknown` con `uptime: null`, mai `0`. La finestra è fissa a 365 giorni ed è dichiarata nella risposta, quindi non accetta `days`. `404` su un provider sconosciuto. |
| `GET` | `/history?provider=&days=` | Bucket giornalieri pre-aggregati, uptime a 7/30/90 giorni, colonne dei mesi. `days` accetta `7`, `30` o `90`; altro è un 400 che li elenca. Senza `provider`, un riepilogo su tutti. |
| `GET` | `/incidents?provider=&state=&q=&days=&page=&pageSize=` | Una pagina della lista incidenti: `{ active, page: { items, page, pageSize, total }, counts: { all, active, resolved } }`. `state` è `all` (default), `active` o `resolved`; `q` cerca nei nomi degli incidenti, senza distinguere maiuscole, e `days` tiene solo gli incidenti iniziati entro quella finestra (entrambi restringono la pagina **e** i conteggi); `pageSize` vale 20 di default, massimo 100. Un `page`, `pageSize`, `state`, `q` o `days` senza senso ricade sulla prima pagina di tutto invece di dare 400. `counts` porta tutti e tre gli stati qualunque sia il filtro, e `active` è la lista degli aperti che la card in evidenza della dashboard mostra su ogni pagina — fuori dalla ricerca, così la card non può sparire mentre l'operatore digita. |
| `GET` | `/incidents/:providerId/:incidentId` | Dettaglio: l'incidente, la cronologia osservata, il log di ciò che è stato inviato, gli altri incidenti aperti del provider, gli ultimi 24 poll e le note dell'operatore su di esso (roadmap 5.3). |
| `POST` | `/incidents/:providerId/:incidentId/notes` | Scrive una nota, `{ body }`, da 1 a 2000 caratteri. L'incidente deve esistere, così un refuso in un URL non accumula in silenzio note che non riguardano nulla. Risponde con la nota salvata. |
| `DELETE` | `/incidents/:providerId/:incidentId/notes/:id` | Ne rimuove una. Legata all'incidente su cui è stata scritta: lo stesso id indirizzato tramite un altro incidente è un `404`, non una corrispondenza. |
| `GET` | `/export/incidents.csv?provider=&state=&q=&days=` | Il risultato della ricerca incidenti come download — gli stessi filtri di `/incidents`, senza paginazione: `provider_id,incident_id,name,impact,status,started_at,updated_at,resolved_at`. RFC 4180, così un nome con virgola, virgolette o ritorno a capo resta un solo campo. Limite di 20 000 righe; un export che lo raggiunge risponde con `X-IsItDown-Truncated: true` invece di sembrare completo. |
| `GET` | `/export/incidents.json?provider=&state=&q=&days=` | Le stesse righe come `{ generatedAt, filter, count, truncated, incidents }` — `filter` riporta con quali filtri l'export è stato preso, così un file ritrovato dopo dice ancora cosa contiene. |
| `GET` | `/export/history.csv?provider=&days=` | Storico di uptime, una riga per provider per giorno: `provider_id,day,worst_status,uptime_pct`. `days` accetta `7`, `30` o `90`, come `/history`; `provider` restringe a uno (`404` se l'id è sconosciuto), e senza di esso ogni provider attivo. |
| `GET` | `/export/history.json?provider=&days=` | La stessa finestra come `{ generatedAt, days, providers }`, con per ogni provider i bucket, la serie giornaliera e le percentuali della finestra da cui sono disegnati i grafici. |
| `GET` | `/feeds/incidents.xml?provider=&state=&q=&days=` | Il risultato della ricerca incidenti come feed RSS 2.0 — roadmap 4.9. Gli stessi filtri di `/incidents`, i 200 più recenti, servito inline così un reader si iscrive invece di salvare un file. Ogni item rimanda alla rotta del dashboard per quell'incidente, e il suo `guid` è la coppia `provider/incidente`, non il link. |
| `GET` | `/feeds/incidents.ics?provider=&state=&q=&days=` | Le stesse righe come file iCalendar, un `VEVENT` per incidente: inizia quando l'incidente è stato visto la prima volta e finisce quando si è risolto, oppure all'ultimo aggiornamento finché resta `TENTATIVE`. |
| `GET` | `/maintenances?provider=&days=` | Le finestre di manutenzione dichiarate — in corso, future e passate — come `{ maintenances }`. `days` limita quanto indietro nel tempo resta visibile una finestra chiusa (default 90, massimo 365); `provider` restringe a uno solo. Senza `provider`, ogni provider abilitato. |
| `GET` | `/notifications?limit=` | Ciò che è stato inviato davvero, dal più recente. Massimo 200. |
| `GET` | `/notifications/log?state=&channel=&page=&pageSize=` | Una pagina del log invii: `{ page: { items, page, pageSize, total }, counts: { all, sent, failed } }`. `state` è `all` (default), `sent` o `failed`; `channel` restringe a un canale; `pageSize` vale 25 di default, massimo 200. Un `page`, `pageSize` o `state` senza senso ricade sui valori di default invece di dare 400. `counts` porta ogni esito qualunque sia il filtro. Ogni elemento porta `attempts`: un invio fallito con più di uno è una notifica non recapitata. |
| `GET` | `/config` | Servizi, impostazioni di polling (`adaptivePolling` e `adaptiveIntervalMinutes` compresi), `retention`, `delivery` (ore di silenzio, riepilogo, limite, `updateInPlace` — vedi [3.8](configuration.it.md#38-politica-di-consegna--ore-di-silenzio-riepiloghi-limiti)), canali, routing e `removed` — i provider rimossi ma ancora ripristinabili. Le credenziali dei canali appaiono come **nomi** di variabili con un flag `isSet`, mai come valori. |
| `GET` | `/config/export` | L'intera configurazione come un `config.yml` dell'edizione Light, come download (roadmap 4.3) — polling, consegna, servizi, instradamento e canali. Le credenziali escono come riferimenti `${VAR}`, mai come valori, e `webpush` viene saltato: una subscription del browser non ha senso in un'edizione senza browser. Il file avvia l'immagine Light così com'è. |
| `POST` | `/config/import` | Lo stesso file, riletto. Accetta lo YAML come corpo della richiesta (`text/yaml`) o come `{ yaml }`. Validato con lo schema di file dell'edizione Light prima di scrivere qualsiasi cosa, così un file sbagliato non cambia nulla; una credenziale letterale viene rifiutata. Un servizio che il file non menziona viene rimosso come lo rimuove la dashboard — soft, ripristinabile, storico intatto — e un blocco `routing` assente lascia stare le regole. Risponde `{ added, updated, removed, channels, routingRules, settings }`. |
| `GET` | `/config/backup` | L'intero database in un unico file (roadmap 4.4), preso con `VACUUM INTO` così è uno snapshot coerente e non un file letto mentre lo si scrive. Si scarica come `isitdown-<data>.db` e porta `X-IsItDown-Secrets: excluded`: le credenziali dei canali stanno in `secrets.env` accanto al database e lì restano. |
| `POST` | `/config/restore` | Quello stesso file, rimesso a posto. Manda i byte come `application/octet-stream`. Controllato prima che venga cancellato alcunché — la firma SQLite, le tabelle e una versione di schema che può essere più vecchia ma mai più nuova di quella che questa build legge — poi portato allo schema corrente come database a sé e copiato dentro tabella per tabella in un'unica transazione, così non serve nessun riavvio e un errore a metà lascia il database com'era. Sostituisce ogni riga che questa edizione conserva; `secrets.env` non viene toccato. Risponde `{ tables, fromSchemaVersion, schemaVersion, secretsKept }`. |
| `GET` | `/config/catalog` | Il catalogo di provider incluso (roadmap 5.11): `{ providers: [{ id, name, adapter, baseUrl, configured }] }`. Risposto dalla memoria — la lista viaggia con l'immagine, quindi non c'è nessun upstream che possa essere giù né niente da tenere sincronizzato. `configured` segna un id già monitorato: la riga resta nel menu e lo dice, invece di sparire. La detection resta la strada per una pagina che la lista non ha. |
| `POST` | `/config/services` | Aggiunge un servizio. `201`, oppure `409` su id duplicato, oppure `400` col nome del campo non valido. |
| `POST` | `/config/services/detect` | Quale adapter legge la pagina all'URL `{ url }`, e la base URL che quell'adapter si aspetta: `{ adapter, baseUrl, probes }`. Prova le forme che IsItDown già legge, in ordine (`/api/v2/summary.json` di Statuspage, `/summary.json` di Instatus, `/index.json` di Better Stack, `/api/v1/components` di Cachet, `/api/status-page/default` di Uptime Kuma, l'`/ajax` di una pagina Uptime.com, poi un feed), e riconosce dall'host i quattro adapter dedicati a un solo provider senza fare alcuna richiesta. Una pagina che nessuno riconosce è un `200` con `adapter: null` e le prove tentate — solo un URL inutilizzabile dà `400`. Non registra e non notifica nulla. |
| `PATCH` `DELETE` | `/config/services/:id` | Modifica, o rimozione. La rimozione è una **cancellazione morbida**: il provider esce subito dalla dashboard e dal ciclo di polling, e la risposta dice per quanto resta ripristinabile (`{ removed, removedAt, restoreUntil }`). `404` su un id sconosciuto o già rimosso. |
| `POST` | `/config/services/:id/restore` | Annulla una rimozione entro la finestra. Non era stato portato via nulla, quindi non si ricostruisce nulla; il buco nella cronologia dei giorni da rimosso viene ricostruito. `404` se non è un servizio rimosso. |
| `DELETE` | `/config/services/:id/permanently` | La metà distruttiva, su un percorso a sé perché non ci si arrivi per sbaglio: propaga a campioni, incidenti, manutenzioni, stato e regole di routing di quel provider. Succede comunque da sé alla scadenza della finestra di ripristino. |
| `PATCH` | `/config/settings` | Impostazioni di polling — `adaptivePolling` e `adaptiveIntervalMinutes` (1–1440) compresi — `retentionDays`, per quanto tempo si conserva lo storico, da 7 a 3650 giorni, e `delivery`, la politica di [3.8](configuration.it.md#38-politica-di-consegna--ore-di-silenzio-riepiloghi-limiti). La patch di `delivery` è parziale a ogni livello, così si può cambiare un campo senza riscrivere gli altri. |
| `GET` | `/config/storage` | Quanto costa la conservazione: dimensione del database su disco, numero di campioni, byte per campione misurati (`measured: false` quando il database è troppo piccolo per misurarli e vale la stima del server) e campioni al giorno con provider e intervallo attuali. |
| `POST` | `/config/storage/maintenance` | `PRAGMA integrity_check`, poi `VACUUM` — roadmap 6.13. Risponde `{ ok, integrity, bytesBefore, bytesAfter, reclaimed, durationMs }`. Una verifica fallita è un `200` con `ok: false` e le parole di sqlite: il file è stato verificato, non riscritto. Non cancella nulla. |
| `PATCH` | `/config/channels/:id` | Attiva/disattiva e imposta i nomi delle variabili. **Rifiuta** un segreto letterale. |
| `PUT` | `/config/channels/:id/secrets` | Salva i **valori** delle credenziali — `{"fields":{"<campo>":"<valore>"}}`. Sola scrittura: il valore va in `secrets.env` accanto al database e nell'ambiente del processo, con effetto immediato, e la risposta è la solita forma nomi-e-`isSet`. `400` per un campo sconosciuto o un valore inutilizzabile. |
| `DELETE` | `/config/channels/:id/secrets/:field` | Dimentica un valore salvato. `409` se la variabile arriva dall'ambiente del container. |
| `POST` | `/config/services/:id/test` | Una fetch reale verso quel provider. Non registra nulla. |
| `POST` | `/config/channels/:id/test` | Una notifica di test, attraverso il dispatcher. |
| `GET` `PATCH` | `/api/preferences` | `{ theme, uiLocale, notificationLocale, mapView, timeZone }`. `timeZone` è `auto` — il fuso di questo browser — oppure un nome IANA; qualunque valore in cui il runtime non sappia formattare una data viene rifiutato. |
| `GET` | `/debug/adapters` | Diagnostica degli adapter: per ogni provider il suo adapter, la base URL e le opzioni, più gli ultimi venti esiti di lettura (durata, tentativi, se era un `304`, e l'errore per intero). In memoria — diagnostica per l'esecuzione che hai davanti, non storico, quindi un restart la svuota. |
| `POST` | `/debug/adapters/:id/probe` | Una lettura della pagina di quel provider, adesso, riportata per intero: l'intera lettura interpretata in caso di successo, l'errore dell'adapter in caso di fallimento (come `200` con `ok: false`, come il test di connessione). Non registra e non notifica nulla. `404` su un id sconosciuto. |
| `POST` | `/poll` | Esegue subito un ciclo, tramite lo scheduler. Restituisce il riepilogo del ciclo. |
| `GET` | `/events` | Server-sent events, una risposta long-lived per tab aperta. `hello` alla connessione (`lastPollAt`, `nextPollAt`, `serverNow`), poi `cycle` alla fine di ogni ciclo (`finishedAt`, `providers`, `failed`, `changedProviders` — nessuna scadenza: lo scheduler ri-arma dopo l'evento, quindi quella nuova arriva con la rilettura). Lo stream è un corriere, non una fonte di verità: dice cosa è cambiato, la dashboard lo rilegge. Non JSON — vedi [6.3](#63-aggiornamenti-live). |
| `GET` | `/metrics` | Esposizione Prometheus. L'unico endpoint non JSON — vedi [6.2](#62-metriche-prometheus). |
| `GET` | `/badge.svg` | Un badge SVG per l'intera flotta: la lettura peggiore in circolazione. Non JSON — vedi [6.4](#64-badge-e-riepilogo-widget). |
| `GET` | `/badge/:providerId.svg` | Lo stesso per un singolo provider. `404` (comunque come badge) se quell'id non esiste. |
| `GET` | `/widget` | Un oggetto di riepilogo piatto per il widget "custom API" di una dashboard homelab — vedi [6.4](#64-badge-e-riepilogo-widget). |
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

### 6.2 Metriche Prometheus

`GET /metrics` risponde nel formato di esposizione testuale di Prometheus
(`text/plain; version=0.0.4`), così qualsiasi Prometheus può fare scrape di
IsItDown senza adattatori in mezzo:

```yaml
scrape_configs:
  - job_name: isitdown
    static_configs:
      - targets: ["isitdown-ui:3000"]
```

Come `/status`, uno scrape è una lettura pura dello stato salvato e non
raggiunge mai un provider: farlo ogni 15 secondi non costa nulla a monte.
Vengono esportati solo i provider abilitati: uno disabilitato ha righe nel
database ma nessun ciclo le aggiornerà più, e un alert su una gauge congelata
è peggio di una serie assente.

| Metrica | Tipo | Etichette | Significato |
|---|---|---|---|
| `isitdown_providers_total` | gauge | — | Provider attualmente sotto polling. |
| `isitdown_provider_up` | gauge | `provider`, `name` | `1` quando il provider si dichiara pienamente operativo, `0` altrimenti — anche prima del primo poll. |
| `isitdown_provider_status` | gauge | `provider`, `status` | `1` sullo stato normalizzato corrente, `0` sugli altri quattro. Distingue `degraded` da `major_outage`, cosa che `_up` non può fare. |
| `isitdown_provider_active_incidents` | gauge | `provider` | Incidenti aperti sulla status page di quel provider. |
| `isitdown_provider_failure_count` | gauge | `provider` | Cicli di poll falliti consecutivi. Diverso da zero significa che è degradata *la nostra* visuale, non che il provider è down. |
| `isitdown_provider_last_fetch_timestamp_seconds` | gauge | `provider` | Quando il suo stato è stato letto con successo l'ultima volta. Assente fino al primo successo. |
| `isitdown_poll_duration_seconds` | gauge | `provider` | Quanto è durato il suo ultimo poll, retry inclusi. |
| `isitdown_polls_total` | counter | `provider`, `outcome` | Poll tentati dall'avvio, con `outcome` `success` o `failure`. |
| `isitdown_notifications_total` | counter | `channel`, `outcome` | Tentativi di invio dall'avvio, con `outcome` `sent` o `failed`. |
| `isitdown_last_cycle_timestamp_seconds` | gauge | — | Quando è finito l'ultimo ciclo. Assente finché questo processo non ne ha eseguito uno. |

I counter sono per processo, non per database: ripartono da zero al riavvio —
che è ciò che Prometheus si aspetta da un counter — invece di essere derivati
dalla tabella `notifications`, che viene potata insieme al resto dello storico
e farebbe tornare indietro un counter.

Due alert che vale la pena avere, e nessuno dei due è "il provider è down":

```yaml
groups:
  - name: isitdown
    rules:
      # Il provider si dichiara down, e lo fa da dieci minuti.
      - alert: ProviderDown
        expr: isitdown_provider_up == 0
        for: 10m
      # Il nostro monitoraggio è cieco — nessun ciclo riuscito da quindici minuti.
      - alert: IsItDownStalled
        expr: time() - isitdown_last_cycle_timestamp_seconds > 900
```

Accanto a esse è committata una dashboard Grafana (roadmap 4.14):
`docs/grafana/isitdown.json`. Importala con **Dashboards → New → Import →
Upload JSON**, poi scegli il Prometheus che raccoglie IsItDown — il file porta
una variabile di datasource e non un uid fisso, quindi non c'è nulla da
modificare prima. Tre righe: la flotta (provider interrogati, provider non
operativi, incident aperti, tempo dall'ultimo ciclo, provider su cui siamo
diventati ciechi) sopra una timeline di stato per provider, il polling (durata e
tasso di errori per provider) e le notifiche (invii per canale ed esito, più gli
errori di un giorno per canale). Un test verifica ogni query del file contro i
nomi delle metriche che `/metrics` esporta davvero, così una serie rinominata fa
fallire la build invece di svuotare un pannello in silenzio.

Non c'è autenticazione: questa è una dashboard locale per un singolo operatore. Non
pubblicare la porta 3000 su una rete di cui non ti fidi.

---

### 6.3 Aggiornamenti live

La dashboard viene notificata invece di interrogare: apre `/events` una volta e
rilegge ciò che l'evento nomina.

```bash
curl -N localhost:3000/events
#   event: hello
#   data: {"lastPollAt":"...","nextPollAt":"...","serverNow":"..."}
#   event: cycle
#   data: {"startedAt":"...","finishedAt":"...","providers":4,"failed":0,"changedProviders":["github"]}
```

Server-sent events, non WebSocket: niente di ciò che la dashboard invia ha
bisogno di un socket — ogni sua scrittura è già una richiesta HTTP — e gli SSE
viaggiano su HTTP semplice con la riconnessione gestita dal browser, quindi non
costano una dipendenza nuova.

Un evento `cycle` rilegge le chiavi economiche (stato, incidenti, notifiche,
manutenzioni); i 90 giorni di cronologia e la mappa solo quando
`changedProviders` non è vuoto, che per la maggior parte dei cicli non lo è. Il
polling non scompare, arretra: con lo stream connesso ogni query scende a un
intervallo di sicurezza di due minuti, perché uno stream che il browser crede
ancora aperto ma i cui eventi hanno smesso di arrivare — un proxy che lo ha
chiuso, un portatile sospeso — lascerebbe la dashboard ferma senza dirlo. Se lo
stream cade, le query tornano al ritmo di 30 secondi finché non si riconnette, e
l'etichetta del prossimo poll nell'header porta un badge **Live** quando è il
push a tenere fresca la pagina.

Dietro un reverse proxy servono buffering disattivato (la risposta manda
`X-Accel-Buffering: no` per nginx) e un read timeout più lungo di un heartbeat,
che viene scritto ogni 20 secondi.

---

### 6.4 Badge e riepilogo widget

Due endpoint in sola lettura rivolti verso l'esterno, non alla dashboard.

`GET /badge/github.svg` disegna un badge piatto — il nome del provider, la sua
lettura attuale e il colore che le corrisponde — da incollare in un README:

```markdown
![GitHub](http://localhost:3000/badge/github.svg)
```

`GET /badge.svg` fa lo stesso per la flotta, riportando la lettura peggiore in
circolazione. Sono disegnati qui invece di essere scaricati da shields.io, così
un'istanza senza accesso a internet in uscita li serve comunque, ed entrambi
rispondono con `Cache-Control: max-age=60` — abbastanza perché un README molto
visitato non diventi un generatore di carico, abbastanza poco perché un badge non
resti verde un'ora dopo l'inizio di un disservizio. Un provider mai interrogato
legge `unknown`, in grigio: mai verde.

`GET /widget` risponde nella forma che `homepage` e Dashy si aspettano da un
widget "custom API" — conteggi e una parola, nessuno storico annidato:

```json
{
  "status": "major_outage",
  "providers": 4,
  "operational": 2,
  "degraded": 1,
  "down": 1,
  "unknown": 0,
  "muted": 1,
  "incidents": 2,
  "lastPollAt": "2026-08-19T14:32:07.000Z",
  "retentionDays": 120
}
```

Nessuno dei due contatta un provider e nessuno dei due registra qualcosa: sono
letture dello stato salvato, ed è questo che li rende interrogabili spesso.
