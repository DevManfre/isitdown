[← README](../README.it.md)

## 10. Client da terminale

Un terzo entrypoint accanto a Light e UI, per chi tiene un pannello del
terminale aperto accanto ai propri log invece di una scheda del browser
(roadmap 17.7). È un **client di sola lettura** dell'API HTTP dell'edizione
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

### 10.2 Come resta live

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

### 10.3 Errori

Un server irraggiungibile, un token rifiutato dall'istanza (`401`/`403`), o
una risposta che non è il JSON atteso da questo client compaiono tutti sulla
riga di stato della connessione del pannello — mai come uno stack trace che
rompe il layout. Un token rifiutato è l'unico caso in cui il client si ferma
invece di riprovare: nessuna attesa risolve una credenziale sbagliata.

### 10.4 Cosa deliberatamente non fa

Ogni richiesta di questo client è una `GET`. Non ha nessun percorso di codice
che scrive — nessun trigger di polling, nessun silenziamento, nessuna
modifica di configurazione — quindi un token affidato a lui ha bisogno solo
di accesso in lettura, e puntarlo su un'istanza non può mai essere scambiato
per amministrarla. Aggiungere accesso in scrittura, un'altra vista, o un
secondo comando è fuori dal perimetro di questa pagina; ognuno sarebbe una
riga di roadmap a sé.
