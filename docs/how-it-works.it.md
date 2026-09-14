[← README](../README.it.md)

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
                   Telegram · webhook · Discord · Slack

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
   Il tick segue la cadenza più corta che qualcuno abbia chiesto: prende
   l'intervallo più breve della configurazione e poi interroga il poller, che può
   solo chiedere di essere eseguito *prima* — è così che un incidente aperto
   stringe il loop senza cambiare un intervallo.

2. **Poller** — sfasa i provider di 250ms l'uno dall'altro, poi li esegue sotto
   `Promise.allSettled` così il guasto di un provider non può toccare il risultato di
   un altro. Fino a `maxRetries` tentativi ciascuno, backoff esponenziale più jitter,
   ogni richiesta col proprio timeout. Esauriti i tentativi registra il fallimento e
   lascia intatto lo stato salvato. Decide anche chi è *dovuto*: un provider viene
   interrogato quando la sua cadenza è trascorsa — il suo `intervalMinutes`, quella
   globale se non ne nomina una, oppure `adaptiveIntervalMinutes` mentre ha un
   incidente aperto — così un tick portato a un minuto da un provider in difficoltà
   non si trascina dietro tutta la flotta.

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

7. **Notifier** — Telegram, webhook generico, Discord e Slack. La composizione del
   messaggio è condivisa (`src/notifiers/formatting.ts`), così i canali non possono
   divergere su ciò che riportano; cambia solo il trasporto. Un canale con un
   formato nativo strutturato chiede lo stesso messaggio a pezzi (`renderParts`)
   invece di comporne uno proprio. Emoji, colore e impaginazione stanno nel
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
| nessuna finestra in corso | inizia una finestra dichiarata | sì — `maintenance_started` |
| una finestra in corso | la stessa finestra termina | sì — `maintenance_ended`, con lo stato in cui il provider è uscito |
| una finestra in corso | qualunque altra cosa cambia a monte (stato, componenti, incidenti) | **no** — soppressa finché la finestra non termina |
| un silenziamento in corso (`mutedUntil` nel futuro) | qualunque cosa | **no** — l'operatore ha detto che già lo sa; polling e registrazione continuano |
| `confirmSamples: N` | un cambio visto in meno di N poll consecutivi | **non ancora** — la baseline resta ferma, quindi lo stesso cambio viene annunciato quando N poll concordano |
| `confirmSamples: N` | un cambio che rientra prima che N poll concordino | **mai** — una pagina che si contraddice non era una notizia |

Il **silenziamento** è la stessa regola con l'operatore al posto del provider: è
un input del diff engine, non un filtro in uscita, ed è per questo che un
provider silenziato mostra un badge sulla dashboard invece di limitarsi a tacere.
Un silenziamento mantiene anche aggiornata la baseline delle notifiche, così
riattivarlo non ripropone quello che è successo mentre era attivo.

Lo **smorzamento dei rimbalzi** (`confirmSamples`) muove la *baseline delle
notifiche* indipendentemente dai campioni: le letture continuano a essere
registrate a ogni poll, così la dashboard dice sempre cosa dice la pagina in
questo momento, mentre la baseline resta ferma finché un cambio non è stato visto
per il numero di poll configurato. Un disservizio reale costa quindi al massimo
`confirmSamples - 1` poll di ritardo, e una discordanza di un ciclo non costa
nulla.

Tutto ciò che sta nella tabella sopra è il diff engine che decide cosa è
*notizia*. Cosa succede a un cambiamento dopo di quello è affare della politica
di consegna — ore di silenzio, finestra di riepilogo, limite orario, un
messaggio per incidente — ed è
[3.8](configuration.it.md#38-politica-di-consegna--ore-di-silenzio-riepiloghi-limiti). L'ordine è
voluto e mai il contrario: il motore risponde a "è cambiato qualcosa", le regole
a "chi se ne occupa", la politica a "gli arriva adesso".

**Regola di soppressione**: finché una finestra di manutenzione dichiarata da
un provider è in corso, nient'altro riguardo quel provider è una novità — un
cambio di stato, un incidente nuovo o aggiornato, un flip di componente,
tutto resta silenzioso finché la finestra non si chiude. L'unica eccezione è
l'inizio e la fine della finestra stessa. Questo significa che un incidente
aperto *durante* una finestra e ancora aperto quando questa termina non
genera mai un proprio `incident_opened` — l'unico annuncio per esso è il
conteggio degli incidenti aperti riportato in `maintenance_ended`. Se resta
aperto molto dopo che la finestra è finita, nulla lo rincorre oltre: si
controlla dalla dashboard.

Due cose che questo *non* cambia: le righe di manutenzione vengono unite alla
timeline degli incidenti della dashboard, ma solo nella prima pagina della
timeline — lo storico di manutenzione più vecchio è disponibile da
`/maintenances`, non dalla timeline. Anche le percentuali di uptime restano
invariate — un campione rilevato mentre una finestra è in corso conta
esattamente come oggi, manutenzione o no.

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
- **Rate limiting** — la richiesta di ogni provider è sfasata di un valore derivato
  dall'hash del suo id, limitato a un decimo della sua cadenza, e l'intervallo stesso
  porta jitter, così né una singola istanza né una flotta martellano un provider nello
  stesso secondo; poiché lo sfasamento è ancorato all'id, aggiungere un provider non
  sposta la richiesta di tutti gli altri. Il validatore memorizzato per provider
  trasforma la maggior parte dei cicli in un `304` senza corpo, e a un provider che
  pubblica due volte l'anno si può dare la sua cadenza più lenta con
  `intervalMinutes`.
- **Un provider che chiede spazio** — un `429`, o qualsiasi risposta che porti
  `Retry-After`, viene rispettato: quel provider salta i cicli finché la finestra che
  ha dichiarato non è passata, invece di essere ritentato dentro di essa. Un `503`
  nudo resta un fallimento ordinario, un `429` senza header ottiene un default di un
  minuto, e una finestra dichiarata è limitata a sei ore così un provider non può
  togliersi dalla dashboard per una settimana. Un poll manuale dalla dashboard chiede
  comunque: è una richiesta che l'operatore ha scelto.
- **Timestamp non affidabili** — un `updatedAt` del provider avanti rispetto al nostro
  orologio non può far iniziare un incidente nel futuro; l'orario di inizio è ancorato
  al poll che lo ha visto per primo, mentre la data dichiarata dal provider resta
  registrata.
- **Scritture concorrenti** — un ciclo modifica lo stato di tutti i provider insieme,
  quindi lo store su file serializza le scritture e dà a ognuna il proprio file
  temporaneo.
