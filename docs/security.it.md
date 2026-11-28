[← README](../README.it.md)

## 11. Sicurezza

Di cosa si fida IsItDown, cosa conserva e dove, e cosa può fargli chi si trova
in una data posizione. Questa pagina è il threat model; come segnalare una
vulnerabilità è in [SECURITY.md](../SECURITY.md).

### 11.1 Il deployment che questo modello presuppone

Un operatore, un'istanza, su una macchina che controlla. La dashboard della UI
edition è pensata per il loopback o per una LAN di cui l'operatore si fida; il
file Compose la pubblica su `127.0.0.1:3000` e da nessun'altra parte. La Light
edition non ha alcun server HTTP.

Tutto quel che segue discende da qui. Dove una funzione va oltre — un token per
un altro host, una pagina pubblica, il push di un provider — è opt-in, spenta di
default, ed è elencata in [11.4](#114-superfici-raggiungibili-da-fuori-della-macchina).

### 11.2 Di cosa ci si fida

| Chi o cosa | Fidato per | Perché |
|---|---|---|
| Chiunque raggiunga la porta della UI edition, senza `API_TOKEN` | Tutto: ogni route, lettura e scrittura | La porta *è* il confine. Legata a `127.0.0.1`, quella persona è l'operatore. |
| Una richiesta dal loopback, con `API_TOKEN` impostato | Tutto (salvo `API_LOCAL_BYPASS=false`) | Tiene funzionante la dashboard dell'operatore senza token nel browser. |
| Chi ha `API_TOKEN` | Lettura: `GET` e `HEAD`, da qualunque host | Una chiave, nessuna identità, nessuna scadenza; non deve mai valere più della lettura ([configurazione §3.12](configuration.it.md#312-raggiungere-lapi-da-un-altro-host)). |
| Chi scrive `config.yml` (Light) | Tutto, indirizzi privati compresi | Lo scrive solo l'operatore. |
| Un plugin in `PLUGINS_DIR` | Tutto ciò che può fare il poller, ogni credenziale risolta | È codice, caricato nel processo ([configurazione §3.14](configuration.it.md#314-plugin-adapter)). |
| La status page di un provider | Niente | Ogni risposta è validata con zod prima dell'uso; una malformata è un errore su quel provider. |
| L'host e il runtime dei container | Tutto | Chi controlla l'host legge il volume dei dati. |
| Un reverse proxy elencato in `TRUSTED_PROXY` | Indicare l'utente (`IDENTITY_HEADER`) e il client vero (`X-Forwarded-For`) | Roadmap 9.3: il nome etichetta solo la cronologia e i marcatori, non concede niente; l'indirizzo del client decide il bypass locale. Non impostato, nessun proxy è fidato ([Docker §4.13](docker.it.md#413-dietro-un-reverse-proxy-che-autentica)). |

Non fidati: `X-Forwarded-For` e l'header d'identità da qualunque indirizzo fuori da
`TRUSTED_PROXY` (li scrive il client, quindi non decidono mai se una richiesta è
locale né chi l'ha fatta — l'header d'identità viene tolto prima che una route lo
veda), un `Origin` del browser che non sia quello della dashboard
(le scritture vengono rifiutate con `403`), un `Host` che non sia `localhost`, un
indirizzo IP o un nome in `ALLOWED_HOSTS`.

### 11.3 Cosa è salvato dove

| Cosa | Dove | A riposo |
|---|---|---|
| Credenziali dei canali, `AI_API_KEY` (UI) | `secrets.env` accanto al database, modo `0600` | In chiaro, protetto dai permessi del file e dal volume |
| Credenziali dei canali (Light) | L'ambiente del container; `config.yml` contiene solo riferimenti `${VAR}` | Ovunque arrivi l'ambiente (`.env`, `env_file`) |
| Configurazione, storico, incidenti, note, log delle consegne (UI) | SQLite nel volume dei dati | In chiaro. Contiene i *nomi* delle variabili, mai i valori delle credenziali |
| Coppia di chiavi web-push (UI) | Due righe nel database | In chiaro |
| Stato (Light) | Il file di stato nel volume dei dati | In chiaro, senza credenziali |
| Backup scaricati e programmati | Dove vengono salvati o caricati | Una copia del database, senza `secrets.env` né la coppia di chiavi web-push |
| Credenziali di upload dei backup | `BACKUP_WEBDAV_URL`, `BACKUP_S3_URL`, nell'ambiente | Come sopra per le variabili d'ambiente |

IsItDown non cifra niente da sé: la cifratura del disco, se serve, è dell'host.
Nessuna risposta dell'API, pagina, riga di log o messaggio d'errore contiene un
segreto risolto, e i test lo verificano; la dashboard può *impostare* una
credenziale ma non rileggerla mai ([configurazione §3.4](configuration.it.md#34-come-vengono-gestiti-i-segreti)).

### 11.4 Superfici raggiungibili da fuori della macchina

Ognuna è spenta finché l'operatore non la accende.

| Superficie | Accesa da | Protetta da | Cosa dà |
|---|---|---|---|
| L'API con un token | `API_TOKEN` | Il token, sola lettura | Ogni `GET`: configurazione (senza valori delle credenziali), storico, incidenti |
| `/public` | `PUBLIC_PAGE=true` | Niente — è pubblica di proposito | I provider in `PUBLIC_PAGE_PROVIDERS` (tutti quelli attivi se non impostata); non accetta input dalla richiesta |
| `/push/:id` | `PUSH_TOKEN` | Il token nell'URL; `404` se non impostato | Un innesco per leggere quel provider *subito* — il body non viene mai interpretato come stato |
| `/heartbeat/:id` | `HEARTBEAT_TOKEN` | Il token nell'URL | Un ping registrato per un provider heartbeat |
| `POST /probe` dell'outpost | Avviare l'outpost | `OUTPOST_TOKEN`, obbligatorio per partire | Una sonda eseguita dalla rete dell'outpost; gli adapter di status page sono rifiutati |
| `/health`, `/ready` | Sempre | Niente | Se il processo è vivo; mai protette, per le sonde dei container |

Un token in un URL (`/push`, `/heartbeat`) finisce nelle impostazioni del provider
e nel log d'accesso di qualunque proxy: trattalo come una credenziale e ruotalo
cambiando la variabile.

### 11.5 Cosa può fare ciascun attaccante

**Sulla LAN, con la dashboard pubblicata oltre il loopback e senza token.**
Tutto quel che può l'operatore: leggere la configurazione, aggiungere o
eliminare provider, cambiare i canali, ripristinare un backup, mandare notifiche
attraverso i canali configurati. È per questo che il file Compose fa il bind su
`127.0.0.1`; pubblicare la porta più in largo è una scelta dell'operatore, e la
risposta è un reverse proxy con la sua autenticazione davanti, più `API_TOKEN` e
`API_LOCAL_BYPASS=false`.

**Con il token API.** Legge tutto quel che restituisce un `GET`. Non scrive
niente: ogni altro metodo risponde `403`, da questa macchina come da qualunque
altra.

**Con accesso in scrittura alla dashboard.** Oltre a cambiare la configurazione,
due cose da sapere:

- *Raggiungere la rete attraverso le sonde.* L'indirizzo di un provider o di una
  sonda è controllato dalla policy di uscita sull'indirizzo in cui si risolve, a
  ogni salto di redirect: la UI edition rifiuta indirizzi privati, di loopback e
  link-local (metadata cloud compresi) a meno che `EGRESS_ALLOW` non li elenchi
  ([configurazione §3.38](configuration.it.md#338-la-policy-di-uscita--cosa-può-raggiungere-una-sonda)).
  La Light edition legge indirizzi privati e di loopback, perché la sua
  configurazione la scrive solo l'operatore; `OUTBOUND_BLOCK_PRIVATE=true` la fa
  rifiutare a sua volta. Il link-local è rifiutato in entrambe.
- *Leggere le credenziali.* Non è possibile dalla dashboard: i valori entrano,
  non escono mai. Una credenziale si può *sostituire*, quindi un canale si può
  puntare altrove.

**Con il socket Docker montato.** L'API Docker non ha una modalità di sola
lettura, e `:ro` sul socket non ne crea una: chi lo tiene controlla il demone, e
quindi l'host. Usa il socket proxy mostrato nella documentazione dell'adapter
`docker`, che risponde solo all'elenco dei container.

**Con un plugin in `PLUGINS_DIR`.** Tutto quel che può fare il processo. Un
plugin lo installa l'operatore, a suo giudizio, come qualunque altro codice.

**A monte, come provider o host sondato.** Può mandare una risposta malformata o
ostile; lo schema zod dell'adapter rifiuta ciò che non si aspetta, e il caso
peggiore è una lettura sbagliata di quel solo provider. Con i riassunti degli
incidenti attivi ([configurazione §3.36](configuration.it.md#336-riassunti-degli-incidenti--impostazioni--implementazione-ai)),
il testo di un incidente del provider arriva al modello scelto dall'operatore; il
riassunto è mostrato come testo del modello, mai eseguito.

**Ricevendo il webhook.** Chi scopre l'URL del webhook può fare POST al
ricevitore. Imposta `WEBHOOK_SECRET` e verifica `X-IsItDown-Signature` e il suo
timestamp, così una richiesta falsificata o ripetuta si riconosce
([configurazione §3.6](configuration.it.md#36-canali-di-notifica)).

### 11.6 Fuori scopo

- **Più utenti.** Niente account, ruoli o audit per utente. Un solo operatore è
  un non-obiettivo dichiarato.
- **Esposizione su Internet senza proxy.** La dashboard non ha autenticazione
  propria; metterla su un indirizzo pubblico senza un reverse proxy che
  autentica davanti è fuori da quel che questo modello copre.
- **Un host o un runtime dei container compromesso.** Chi li ha ha il volume dei
  dati, `secrets.env` compreso.
- **Cifratura a riposo.** Lasciata alla cifratura del disco dell'host.
- **Status page dietro login.** Si leggono solo status page pubbliche.
