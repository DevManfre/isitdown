[← README](../README.it.md)

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
History · Log invii · Settings. Poi prova i due controlli a runtime nell'header:

- il pulsante del **tema** cicla chiaro → scuro → sistema e sopravvive a un reload;
- lo switch **EN / IT** cambia ogni stringa senza ricaricare la pagina, incluso il
  formato dell'ora (`7:36 PM` contro `19:36`) e il separatore decimale (`99.87%`
  contro `99,87%`).

La linguetta del browser risponde alla stessa domanda senza essere guardata:
mentre qualcosa non va, il titolo conta i provider in difficoltà (`2 provider in
difficoltà · IsItDown`) e la favicon prende un punto nel colore di quella
gravità. Con la flotta tranquilla tornano l'icona e il titolo originali della
pagina, così un punto nella linguetta significa sempre che c'è qualcosa da
aprire. Un provider mai letto con successo non è "difficoltà" — un primo ciclo
non ancora arrivato non deve mostrare una linguetta rossa — e un provider
disabilitato è fuori dalla dashboard del tutto.

La barra dei controlli di ogni vista segue una regola sola: un controllo che
cambia ciò che è a schermo è un gruppo segmentato — pulsanti uniti in una
striscia con bordo e sfondo tenue, e quello attivo sollevato — mentre tutto ciò
che porta via la vista sta dietro a un unico menu **Scarica**. Prima un toggle di
intervallo, due frasi di download e due coppie di formati avevano tutti lo stesso
peso, e niente diceva quali stessero insieme.

Su **History**, cliccare la riga di un provider apre il suo drawer: le tre
finestre, le barre giornaliere con la loro legenda di colori e — roadmap 5.20 —
un **calendario annuale**, una cella per giorno colorata dallo stato peggiore di
quel giorno. La retention può arrivare a 3650 giorni mentre il grafico più ampio
restava una riga di barre a 90 giorni, quindi tutto ciò che era più vecchio
veniva salvato e mai mostrato; il calendario è quell'anno. Un giorno che nessuno
ha campionato è disegnato smorzato e non verde, e passando sopra una cella si
legge com'è andato quel giorno e quanto è stato attivo.

Sopra la lista, **Confronta** (roadmap 5.7) sovrappone l'uptime giornaliero di
due provider sugli stessi assi — la domanda che pone davvero una scelta tra
fornitori, e quella a cui la classifica dal peggiore non può rispondere perché
non mette mai due righe sulla stessa scala. Si apre sui due provider peggiori,
ciascun selettore cambia il proprio lato, e scegliere il provider già presente
sull'altro lato li scambia. Le due linee prendono colori propri e non colori di
stato: il grafico dice chi ha misurato meglio, non che uno è operativo e l'altro
no.

Gli stessi dati via HTTP:

```bash
curl -s localhost:3000/history/calendar?provider=github | jq '.measuredDays, .uptime'
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

Rimuovere un provider si può annullare. La conferma dice cosa la rimozione si
porterà via (campioni, incidenti, finestre di manutenzione, regole di routing e
lo span di cronologia dietro di essi), poi il provider esce dalla dashboard
mentre la sua storia aspetta la finestra di ripristino: `Impostazioni →
Rimossi di recente` offre **Ripristina** e **Rimuovi ora** fino alla scadenza:

```bash
curl -s -X DELETE localhost:3000/config/services/vercel
#   {"removed":"vercel","removedAt":"...","restoreUntil":"..."}
curl -s localhost:3000/config | jq '.removed[] | {id, restoreUntil}'
curl -s -X POST localhost:3000/config/services/vercel/restore    # annulla
```

La vista **Log invii** è l'altra metà della stessa onestà: ogni notifica
tentata, prima quelle fallite, con ogni riga che si apre sul payload esatto
inviato e sull'errore riportato dal canale. Una credenziale scaduta si vede lì,
invece di manifestarsi come avvisi che hanno smesso di arrivare in silenzio.

Un invio fallito viene ritentato fino a tre volte con backoff esponenziale e
jitter, così un rate limit o un ricevitore webhook che si riavvia non fanno più
perdere un avviso. Si scrive una riga per *messaggio*, non per tentativo, e
porta con sé quanti tentativi è costato: un invio riuscito al secondo colpo
risulta consegnato, uno che ha speso tutti e tre è marcato **Non recapitata** —
l'avviso è perso, che è un'affermazione diversa da "fallita". Il test di invio
dalle impostazioni fa un solo tentativo di proposito: chi l'ha premuto sta
aspettando la risposta.

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

Nell'edizione UI i due valori si salvano da **Settings → Telegram**, oppure via
API: in ogni caso non c'è nessun riavvio di mezzo.

```bash
curl -s -X PUT localhost:3000/config/channels/telegram/secrets \
  -H 'content-type: application/json' \
  -d '{"fields":{"botToken":"123456:AA...","chatId":"-1001234567890"}}'

curl -s -X PATCH localhost:3000/config/channels/telegram \
  -H 'content-type: application/json' -d '{"enabled":true}'
curl -s -X POST localhost:3000/config/channels/telegram/test    # {"ok":true}
```

Passando invece da `env_file`, il container va ricreato perché le legga:

```bash
sed -i 's|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=123456:AA...|' .env
sed -i 's|^TELEGRAM_CHAT_ID=.*|TELEGRAM_CHAT_ID=-1001234567890|' .env
docker compose --profile ui up -d --force-recreate
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
| Container fermo su `starting` per sempre | L'healthcheck non è mai passato. Light: `state.json` non viene scritto, quindi nessun ciclo è andato a termine. UI: `/ready` risponde 503 — il campo `reason` dice quale dei tre guasti è, e `docker inspect` lo riporta nel log dell'health. |
| La dashboard carica ma la griglia è vuota | Nessun ciclo è ancora girato. `POST /poll`, oppure aspetta un intervallo. |
| Un provider mostra `unknown` | Non è mai stato interrogato con successo. Edizione UI: **Impostazioni → la riga del provider → Diagnostica** mostra le ultime letture con i loro errori e legge la pagina su richiesta (`GET /debug/adapters`, `POST /debug/adapters/<id>/probe`). Una pagina che si legge ma non produce nulla — uno scrape il cui selettore non corrisponde più — viene segnalata lì. |
| Nessuna notifica durante la notte, o un messaggio invece di diversi | La politica di consegna sta facendo il suo lavoro. Controlla **Impostazioni → Consegna** (o il blocco `delivery`): le ore di silenzio scartano ciò che sta sotto la soglia, e il riepilogo lo trattiene per la sua finestra. |
| Un provider viene interrogato e un altro no | O il suo `intervalMinutes` non è ancora trascorso, oppure ha risposto `Retry-After` e viene lasciato in pace finché la finestra dichiarata non passa — `docker logs` porta `provider asked to be left alone` con la scadenza. |
| Il provider è `degraded` ma Incidents è vuoto | Corretto. Statuspage deriva l'indicator anche dallo stato dei componenti: può non esistere alcun incidente registrato. |
| L'uptime di un provider è `0%` | Ha esattamente un campione e non era operational. Sale con i cicli successivi. |
| Una colonna del mese mostra `—` | Nessun campione in quel mese. Volutamente non `0%`, che si leggerebbe come un outage lungo un mese. |
| Non arriva mai nessuna notifica | Il canale è `enabled` e la sua variabile si risolve? `GET /config` mostra `isSet` per ogni campo. Poi `POST /config/channels/<id>/test`. |
| Arrivano notifiche ripetute per la stessa cosa | Non dovrebbe essere possibile: decide solo il diff engine. Raccogli `docker logs` e il feed `/notifications`. |
| La dashboard mostra chiavi grezze tipo `nav.overview` | Una chiave senza voce nel catalogo — dovrebbe essere impossibile, i test delle guardie sulla lingua colgono ogni chiamata letterale `t("...")` prima del rilascio. Una chiave costruita dinamicamente (`t(prefisso + suffisso)`) è la sola forma che quei test non possono vedere; controlla il punto di chiamata. |

Alza il dettaglio con `LOG_LEVEL=debug`, che logga ogni singolo tentativo di poll,
retry compresi.

I log vanno su stdout, che è ciò che vuole un container e ciò che non basta a
un'installazione bare-metal: imposta `LOG_FILE=/var/log/isitdown/isitdown.log` e le
stesse righe vengono accodate anche lì, ruotate a `LOG_MAX_BYTES` in
`LOG_MAX_FILES` generazioni numerate. Il file è aggiuntivo — stdout continua a
portare tutto, quindi `docker logs` funziona ancora su un container che ha
entrambi. Un percorso non scrivibile disattiva il file dopo averlo detto una volta
su stdout; polling e notifiche non vengono mai bloccati da un disco pieno o in
sola lettura.
