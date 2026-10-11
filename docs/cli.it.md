[← README](../README.it.md)

## 10. Client da terminale

Un terzo entrypoint accanto a Light e UI, per chi tiene un pannello del
terminale aperto accanto ai propri log invece di una scheda del browser
(roadmap 17.7). Il suo comando `watch` è un **client di sola lettura** dell'API HTTP dell'edizione
UI — non una seconda dashboard e non un secondo motore — quindi tutto ciò che
mostra compare anche su `http://localhost:3000`, e niente di quello che fa può
modificare l'istanza a cui si collega.

```bash
node dist/cli/index.js watch --url http://localhost:3000
```

oppure, dai sorgenti, compilato una volta con `npm run build:cli` (vedi
[9.1](development.it.md#91-struttura-del-repository) per dove si trova
`src/cli/` e perché non importa mai `src/ui`).

### 10.1 `isitdown watch`

```
usage: isitdown watch [--url <url>] [--token <token>] [--interval <seconds>]
```

| Opzione | Predefinito | Significato |
|---|---|---|
| `--url` | `http://localhost:3000` | L'istanza dell'edizione UI da leggere. |
| `--token` | `$API_TOKEN` | Un token API di sola lettura ([6](api.it.md#6-api-http)). Mai stampato, mai finito in un log: passalo con `--token` solo dove l'ambiente non è condiviso con qualcosa che potrebbe farlo trapelare. |
| `--interval` | `30` | Secondi tra una lettura e l'altra del polling di riserva, mentre lo stream live non è disponibile. |

La vista è un solo schermo, ridisegnato sul posto: la flotta — provider,
stato, da quando ha quello stato, e l'orario dell'ultimo campione — e, sotto,
una coda con gli ultimi cambi di stato man mano che arrivano. Non c'è
navigazione, non c'è un grafico, e non c'è un secondo schermo; è una scelta
deliberata, non uno stato provvisorio (vedi la nota di perimetro nella issue
di partenza). `Ctrl+C` per uscire.

### 10.2 `isitdown discover`

```
utilizzo: isitdown discover [percorso...] [--yaml | --json]
```

Il secondo comando (roadmap 2.3), e quello che non ha bisogno di un'istanza:
legge i file di un progetto e propone i provider del catalogo da cui il progetto
dipende. Offline — legge il catalogo incluso e nient'altro, non scarica nulla e
non scrive nulla.

| File | Cosa legge |
|---|---|
| `package.json` | nomi delle dipendenze — `@aws-sdk/*` è AWS, `openai` è OpenAI |
| `docker-compose.yml`, `compose.yaml`, `Dockerfile` | registry delle immagini — un `postgres:16` nudo è Docker Hub, `ghcr.io/…` è GitHub |
| `.env`, `.env.*` | URL e nomi host nei valori |
| `*.tf` | sorgenti e blocchi dei provider — `hashicorp/aws`, `provider "azurerm"` |
| `requirements*.txt`, `pyproject.toml`, `Pipfile` | nomi dei pacchetti — `boto3`, `anthropic` |
| `go.mod` | percorsi dei moduli |
| `hosts` | nomi host |
| altri `.yml`, `.json`, `.toml`, … | qualunque URL |

Un host corrisponde a un provider quando il suo dominio registrabile è quello
della status page — `api.sendgrid.com` e `status.sendgrid.com` sono entrambi
`sendgrid.com` — quindi quella metà cresce con il catalogo. Una piccola tabella
di indizi in `src/adapters/discover.ts` copre i provider le cui dipendenze non
condividono un dominio con la loro status page. Una cartella viene percorsa fino
a otto livelli, escludendo `node_modules`, `.git`, `vendor`, gli output di build
e i virtualenv; `localhost`, `.internal`, `.local` e gli indirizzi IP nudi non
vengono mai proposti.

Ogni provider viene stampato con ogni riga che l'ha indicato, poi gli host che
nessuna voce del catalogo riconosce — candidati da aggiungere per URL se hanno
una status page. `--yaml` stampa un blocco `services:` che il `config.yml`
dell'edizione Light accetta così com'è; `--json` il risultato completo.

### 10.3 Come `watch` resta live

Il client apre `GET /events` — lo stesso stream a eventi lato server che
`src/ui/routes/events.routes.ts` serve alla dashboard — e rilegge
`GET /status` a ogni frame `cycle`, non solo a quelli che nominano un
provider cambiato: un ciclo senza nulla da segnalare fa comunque avanzare la
colonna "ultimo campione", e una vista che si aggiornasse solo sui cambi
sembrerebbe ferma a ogni ciclo silenzioso, che è la maggior parte di essi. Lo
stream in sé non porta mai i dati di un provider, solo il fatto che un ciclo
è terminato; `/status` è la lettura che non può mai andarne fuori sincrono.

Se lo stream non può essere aperto, o cade dopo esserlo stato, il client
ricade sul polling di `/status` a `--interval` mentre continua a riprovare lo
stream in background — una connessione caduta diventa aggiornamenti più
lenti, mai uno schermo bloccato, e la riconnessione è silenziosa: non c'è
nulla da riavviare a mano.

### 10.4 Errori di `watch`

Un server irraggiungibile, un token rifiutato dall'istanza (`401`/`403`), o
una risposta che non è il JSON atteso da questo client compaiono tutti sulla
riga di stato della connessione del pannello — mai come uno stack trace che
rompe il layout. Un token rifiutato è l'unico caso in cui il client si ferma
invece di riprovare: nessuna attesa risolve una credenziale sbagliata.

### 10.5 Cosa `watch` deliberatamente non fa

Ogni richiesta di questo client è una `GET`. Non ha nessun percorso di codice
che scrive — nessun trigger di polling, nessun silenziamento, nessuna
modifica di configurazione — quindi un token affidato a lui ha bisogno solo
di accesso in lettura, e puntarlo su un'istanza non può mai essere scambiato
per amministrarla. Aggiungere accesso in scrittura o un'altra vista è fuori dal
perimetro di questa pagina; ognuno sarebbe una riga di roadmap a sé.
`discover` (10.2) è un comando separato che legge file locali, non l'istanza.
