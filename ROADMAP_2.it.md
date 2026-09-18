# ROADMAP 2 (italiano, commentata)

Versione italiana di `ROADMAP_2.md`, con ogni voce spiegata: **cosa cambia** nel
prodotto e **a cosa serve** all'operatore. Stesso contratto della prima roadmap:
**niente qui è impegnativo**, la rete è volutamente larga, il file esiste per
essere potato, non eseguito.

Due differenze rispetto alla prima roadmap.

Primo, la numerazione continua da `docs/roadmap/ROADMAP.md`, che finisce alla
sezione 8: qui si riparte dalla 9. Un id di riga è unico tra i due file, quindi
una nota può citare `2.5` o `12.3` senza specificare quale roadmap.

Secondo, il punto di partenza non è più un prodotto vuoto. La prima roadmap
chiedeva *cosa può fare IsItDown*; quasi tutte le risposte economiche sono già
state costruite. Le domande rimaste sono di altro tipo:

- **Quello che la dashboard dice è vero?** L'uptime è calcolato dai campioni
  raccolti dal poller. Quando il poller non girava non ci sono campioni, e oggi
  niente distingue "il provider stava bene" da "nessuno stava guardando". Ogni
  numero della vista History eredita questa ambiguità.
- **Cos'è IsItDown adesso?** È nato come aggregatore di status page. Ha probe
  HTTP, TCP, DNS e TLS (1.8, 1.9), quindi monitora anche cose che una status
  page non ce l'hanno. Sono due prodotti nello stesso binario, e la roadmap non
  ha mai detto quale dei due vince una discussione.
- **Quali non-goal meritano ancora di essere non-goal?** `README.md` esclude
  auth multi-utente, qualunque forma SaaS e l'app mobile. Quelle righe sono
  state scritte quando lo strumento era un operatore su una macchina con otto
  provider. La sezione 9 le rimette sul tavolo con una forma concreta allegata,
  perché "no" è una risposta molto migliore quando qualcuno ha scritto quanto
  costerebbe il "sì".

Legenda (invariata):

- **S** — un giorno o meno, entra nelle giunture esistenti.
- **M** — qualche giorno, può richiedere una nuova tabella, rotta o metodo di interfaccia.
- **L** — cambiamento strutturale: nuovo sottosistema, nuovo concetto nel modello dati,
  o uno spostamento di *cosa è* il prodotto.
- ⚠️ — va contro un non-goal dichiarato o un principio in `README.md` (o nel
  manuale sotto `docs/`); richiede una decisione deliberata prima di essere
  pianificata, non solo una priorità.
- 🔁 — ripresa da `docs/roadmap/ROADMAP.md` non consegnata, ma riformulata qui
  perché il motivo per cui non è passata è cambiato. L'id originale è nella nota.
- ✅ — consegnata. Il commit è nominato nella nota.
- ◐ — consegnata in parte: cosa è entrato e cosa no è nella nota.

## Cosa è già uscito

Undici righe, consegnate insieme in una sessione. Ognuna porta lo stato nella
propria sezione; qui c'è solo l'elenco, perché scorrere ottocento righe per
sapere cosa resta non è un modo di leggere un file come questo.

| Riga | Commit |
| --- | --- |
| ✅ 9.1 — chi fa fede, dichiarato per provider | `0357705` |
| ✅ 10.1 — "non osservato" distinto da "up" | `8452a09` |
| ✅ 10.2 — la definizione di uptime, pubblicata e testata | `c7520ed` |
| ✅ 10.4 — i campioni marcati con il loro parser | `ee41266` |
| ✅ 10.7 — bucket giornalieri nel fuso dell'operatore | `9b8f74f` |
| ✅ 11.1 — adapter JSON con mappatura dichiarata | `864d565` |
| ✅ 12.1 — annotazioni sulla timeline | `66c94e0` |
| ✅ 12.2 — MTTR, MTBF e classifica | `2ab9838` |
| ✅ 12.3 — incidenti per ora e giorno | `2ab9838` |
| ◐ 13.1 — problemi-primi e densità; virtualizzazione no | `694d6c7` |
| ✅ 14.1 — anteprima del messaggio per canale | `2db60e7` |

Due delle tre righe che la chiusura del file indicava come più forti — **10.1** e
**12.1** — sono passate. La terza, **15.1**, no.

---

## 9. Decisioni di identità — i non-goal, riaperti

Non è una coda di lavoro. Ogni riga è una domanda con una risposta proposta,
dimensionata come se la risposta fosse sì. L'output della sezione è una
decisione scritta in `README.md`, anche quando la decisione è "ancora no": un
non-goal sopravvissuto a un'alternativa quotata vale molto più di uno mai messo
in discussione.

### ✅ 9.1 — Aggregatore o monitor di uptime: sceglierne uno · L ⚠️
**Stato.** ✅ `0357705`. Consegnata con una risposta diversa dalla proposta: **entrambi, dichiarato per provider** — `authority` è `declared` o `observed`, il default viene dall'adapter (`kind: page | probe`) e non è salvato. Scritta in `README.md` e `docs/how-it-works.md` §7.7.
**Cosa cambia.** Si dichiara una volta sola cosa è il prodotto. Proposta:
IsItDown resta un aggregatore; i probe restano un supporto che può
*contraddire* una status page (1.10) ma mai sostituirla. Un paragrafo nel
manuale, una volta.
**A cosa serve.** I probe (1.8, 1.9) hanno reso ambigua l'identità e niente l'ha
risolta. Aggregatore significa *riporta ciò che il provider ammette*; monitor
significa *decidi tu*. Le due cose non concordano su quasi nulla a valle: cosa
significa uptime, se un "operational" dichiarato può essere scavalcato, se la
latenza è una metrica di prima classe, cosa mostra per primo l'Overview.

### 9.2 — Una vista pubblica in sola lettura · L ⚠️
**Cosa cambia.** Tre forme, a costo crescente: (a) export statico —
`npm run export:public` scrive un HTML autonomo con la flotta attuale e 90
giorni di storia, buono per un bucket o Pages, nessun server, nessuna superficie
d'attacco nuova; (b) una seconda porta che serve un sottoinsieme read-only delle
rotte esistenti; (c) condivisione completa con link e scadenze.
**A cosa serve.** Era la 5.1 della prima roadmap, mai consegnata, ed è la cosa
più richiesta che un aggregatore di stato possa fare. La forma (a) rispetta ogni
non-goal e copre quasi tutta la domanda: si parte da lì, e solo da lì.

### 9.3 — Una passphrase condivisa, non degli account · M ⚠️
**Cosa cambia.** Una passphrase in una variabile d'ambiente, un cookie firmato,
nessuna tabella utenti, nessun ruolo.
**A cosa serve.** Il non-goal è *auth multi-tenant*, ed è un buon non-goal. Ma
"nessuna auth" regge solo finché la dashboard sta su `127.0.0.1`, e il pubblico
reale sta dietro Tailscale o un reverse proxy. Questo non rende il prodotto
multi-utente e smette di costringere la storia di deploy a essere "mettici un
proxy davanti". Si abbina alla 4.15 (token API read-only).

### 9.4 — Chi ha silenziato GitHub? · S ⚠️
**Cosa cambia.** Una stringa "attore" registrata su ogni scrittura (mute,
modifica regola, credenziale impostata), presa da un header configurabile e con
default `local`.
**A cosa serve.** Audit trail senza sistema di identità. Se passa la 9.3, la
richiesta successiva è l'audit, e quella dopo ancora sono gli account: questa
riga anticipa la prima senza aprire la seconda. Rende anche spiegabili il log di
consegna e la cronologia impostazioni quando due persone condividono
un'istanza.

### 9.5 — Mobile: PWA o niente · M ⚠️
**Cosa cambia.** Un manifest, un service worker, un layout che regge i 390px.
**A cosa serve.** "Niente app mobile" è un non-goal, ma il web push arriva già
sul telefono e la dashboard è l'unico pezzo che lì non funziona. Va deciso una
volta invece di andare alla deriva: la 5.21 è aperta dalla prima roadmap mentre
la navigazione mobile è stata costruita comunque.

### 9.6 — Federazione per l'homelab multi-sito · L ⚠️
**Cosa cambia.** Non un protocollo: un'istanza aggiunge il `/status` di
un'altra istanza come *provider* attraverso l'interfaccia adapter esistente. Il
sito B appare sull'Overview del sito A come un tile con stato composito, e i
gruppi (2.6) danno il dettaglio.
**A cosa serve.** Risponde alla 8.6 senza nuovi sottosistemi né nuovi concetti:
un adapter e una decisione.

### 9.7 — Un'istanza demo pubblica · M ⚠️
**Cosa cambia.** Un container, storia sintetica preseminata, reset ogni ora,
immagine reale.
**A cosa serve.** Ogni tool self-hosted cresciuto ne aveva una: si prova prima
di installare. Il non-goal che sfiora è operativo, non architetturale —
qualcuno deve tenerla in piedi per sempre.

### 9.8 — Dire di no, per iscritto · S
**Cosa cambia.** La sezione non-goal di `README.md` porta il *motivo* e
l'alternativa scartata, non solo il rifiuto.
**A cosa serve.** È la riga più economica del file e quella che risparmia più
discussioni future, qualunque cosa concludano le 9.1–9.7.

---

## 10. Verità nei dati

La sezione più preziosa e la meno visibile. Tutto ciò che la dashboard afferma
poggia su campioni, e niente oggi difende la qualità di quei campioni. Un
grafico sbagliato è peggio di un grafico assente, perché nessuno verifica un
grafico di cui si fida.

### ✅ 10.1 — Distinguere "up" da "non osservato" · M
**Stato.** ✅ `8452a09`. Tabella `poll_cycles`, un silenzio oltre il doppio della cadenza è un'assenza, copertura disegnata come tratteggio. I giorni precedenti al primo ciclo registrato rispondono `null`, non zero.
**Cosa cambia.** Registrare la liveness del poller come traccia propria (una
riga per ciclo completato), derivare una *copertura* giornaliera, disegnare gli
intervalli non coperti come stato distinto tratteggiato in ogni grafico, ed
escluderli dal denominatore dell'uptime.
**A cosa serve.** È il bug fondativo di tutto il sottosistema storico. Se il
container resta giù sei ore, quelle ore non sono in `status_samples` e ogni
cifra di uptime le tratta silenziosamente come "tutto bene" — o come buco, a
seconda della query. Finché non esiste, ogni numero della History ha un
asterisco che nessuno vede.

### ✅ 10.2 — Pubblicare la definizione di uptime, e testarla · S
**Stato.** ✅ `c7520ed`. `docs/how-it-works.md` §7.6, con ogni riga della tabella asserita in `test/ui/uptimeDefinition.test.ts`, più il tooltip sul numero.
**Cosa cambia.** Scrivere la definizione in `docs/how-it-works.md`, asserirla
con un test table-driven, e mostrarla in un tooltip sul numero stesso.
**A cosa serve.** Un'ora `degraded` conta come giù, su, o metà? E la
`maintenance`, che il diff engine silenzia (2.1)? Il codice una risposta ce
l'ha; l'operatore no.

### 10.3 — Precaricare la storia dal provider · M
**Cosa cambia.** Importare gli incidenti passati esposti da Statuspage e dai
provider a feed, una volta alla creazione del provider, marcati come
*importati* e non *osservati*, così la traccia di copertura della 10.1 resta
onesta.
**A cosa serve.** Un'installazione nuova mostra 90 giorni di History vuota,
proprio nel momento in cui si decide se lo strumento vale. È il miglior
intervento disponibile sulla prima esecuzione.

### ✅ 10.4 — Marcare i campioni con il loro parser · S
**Stato.** ✅ `ee41266`. `Adapter.version` più la colonna `adapter_version` su `status_samples` e `component_samples`. `null` sulle righe precedenti: revisione ignota, non una pretesa.
**Cosa cambia.** Una colonna `adapter_version`, incrementata a mano quando
cambia una mappatura di severità.
**A cosa serve.** Un campione dice cosa è stato letto, mai *come*. Se cambi la
mappatura di un adapter, il passato si ri-disegna in silenzio. Assicurazione
economica contro la classe di bug che nessuno nota per mesi.

### 10.5 — Accorgersi che un adapter è morto in silenzio · M
**Cosa cambia.** Hash del payload normalizzato per provider: un hash fermo da N
giorni su un provider storicamente mutevole, o un parse che produce meno campi
del proprio fixture, alza un flag di salute sul tile del provider. Vale anche
per RSS e per le forme JSON.
**A cosa serve.** L'adapter di scraping HTML (1.6) è uscito con l'avviso "può
rompersi in silenzio" e nessun meccanismo dietro. Un selettore che smette di
matchare restituisce *operational* per sempre.

### 10.6 — Aggregare invece di cancellare · M
**Cosa cambia.** I campioni più vecchi della finestra di retention diventano
aggregati giornalieri, conservati per sempre; la retention diventa una politica
di risoluzione invece che di amnesia.
**A cosa serve.** Un riepilogo giornaliero di un anno fa non costa quasi nulla
ed è l'unica cosa che rende possibili il confronto anno su anno (8.2) e il trend
SLA (4.13).

### ✅ 10.7 — Bucket giornalieri nel fuso dell'operatore · S
**Stato.** ✅ `9b8f74f`. Lo store riceve segmenti a offset costante, tagliati al minuto della transizione DST; l'aggregazione resta in SQL. Un giorno spezzato è sommato dai due lati.
**Cosa cambia.** Decidere una volta se i bucket seguono la preferenza di fuso
(5.9) e chiudere i bordi DST con un test che ne attraversa uno.
**A cosa serve.** L'aggregazione oggi bucketizza per giorno UTC: un utente a
UTC+13 vede l'incidente sulla barra sbagliata e "oggi" sul calendario di calore
(5.20) non è il suo oggi.

### 10.8 — Replay: perché mi è arrivato quell'alert? · M
**Cosa cambia.** Conservare il payload grezzo delle N letture più recenti per
provider e aggiungere un replay che ri-esegue il diff engine su due payload
salvati, stampando il percorso decisionale: quale regola ha matchato, quale
floor si è applicato, se sono intervenuti il flap damping (2.5) o le quiet hours
(3.11).
**A cosa serve.** L'`explain` del routing ha dimostrato che il pattern vale:
questa riga lo estende da *cosa succederebbe* a *cosa è successo*.

### 10.9 — Aprire un database vecchio in CI · S
**Cosa cambia.** Un database fixture dello schema più vecchio supportato,
committato; uno step CI lo apre con la build corrente, esegue le migrazioni e
asserisce che le viste renderizzino.
**A cosa serve.** Niente altro protegge il percorso di upgrade di chi tiene
acceso questo strumento da un anno.

### 10.10 — Sopravvivere a uno spegnimento sporco · S
**Cosa cambia.** Asserire le impostazioni WAL, aggiungere una prova di
corruzione alla suite (troncare il file, uccidere a metà transazione) e rendere
il fallimento un messaggio leggibile con puntatore al backup (4.4) invece di uno
stack trace al boot.
**A cosa serve.** Il blackout a metà scrittura è il guasto più normale
dell'homelab.

### 10.11 — IsItDown guarda IsItDown · M
**Cosa cambia.** La salute della flotta stessa diventa un tile di prima classe,
con lo stesso percorso diff engine → notifier di qualunque provider (regola
ferma: mai notifiche fuori da quel percorso).
**A cosa serve.** Cicli persi, durata di poll in crescita, error rate di un
adapter che sale, un notifier che fallisce ogni invio: oggi sono visibili in
`/metrics` (4.1), quindi solo a chi ha Prometheus. Così lo strumento può dirti
che ha smesso di funzionare.

### 10.12 — Un orologio deterministico nei test · S
**Cosa cambia.** Un clock iniettabile.
**A cosa serve.** Polling adattivo, flap damping, digest, quiet hours, cap e
retry dipendono tutti dal tempo, e i loro test oggi negoziano con l'orologio
reale. I casi scomodi (una finestra digest a cavallo di mezzanotte, un confine
quiet-hours dentro un fold DST) diventano testabili invece che evitati.

---

## 11. Copertura — altre cose che vale la pena guardare

La prima roadmap trattava la copertura come una lista di adapter da scrivere.
Quasi tutta la lista è uscita, e la lezione è che gli adapter *generici* (1.5,
1.6) hanno portato molti più provider di quelli su misura. Questa sezione segue
la lezione: righe che scalano, dove un provider nuovo costa configurazione e non
codice.

### ✅ 11.1 — Adapter JSON generico con mappatura dichiarata · M
**Stato.** ✅ `864d565`. Adapter `json`, validato al salvataggio e non alla lettura. Un percorso è nomi, punti e `[n]` — non JSONPath.
**Cosa cambia.** Un'espressione di path per campo più una mappa di parole-stato,
validata con `zod` al momento della configurazione e non della lettura.
**A cosa serve.** Copre il buco tra Statuspage (già coperto) e lo scraping HTML
(fragile): moltissime status page servono JSON ottimo, in una forma che nessuno
ha standardizzato. Stessa leva dell'adapter RSS (1.5), e la coda lunga diventa
un form della dashboard.

### 11.2 — Un catalogo che si aggiorna senza immagine nuova · M
**Cosa cambia.** Scaricare un JSON di catalogo firmato a cadenza lenta, con
fallback sulla copia interna, e non applicare mai in automatico una modifica a
un provider già configurato: solo proporla.
**A cosa serve.** Il catalogo da 42 provider (1.14, 5.11) viaggia dentro la
build, quindi una URL di stato spostata richiede una release. Così il catalogo
resta utile tra una release e l'altra, senza trasformare lo strumento nel client
del server di qualcuno.

### 11.3 — Sottoscrizioni per regione e componente · M
**Cosa cambia.** Un provider dichiara le regioni che gli interessano e l'adapter
filtra prima che il diff engine veda qualcosa.
**A cosa serve.** L'alerting per componente esiste (2.9), ma gli hyperscaler
richiedono l'altro asse: un incidente AWS in `ap-south-1` non è un incidente per
una flotta a Francoforte. Trasforma AWS da sorgente di rumore a segnale.

### 11.4 — Scadenza dominio e DNSSEC · S
**Cosa cambia.** Due controlli in più sopra quelli che l'adapter DNS già fa.
**A cosa serve.** La scadenza TLS è uscita dentro il probe HTTP (1.9); la
scadenza del dominio è la stessa catastrofe silenziosa con miccia più lunga, e
un guasto DNSSEC butta giù un sito in un modo che nessuna status page riporta.

### 11.5 — Un grafo delle dipendenze tra provider · L
**Cosa cambia.** Un `dependsOn` dichiarato per provider. Gli archi sono
dichiarati dall'operatore, mai inferiti.
**A cosa serve.** Metà della flotta gira sull'altra metà: Vercel su AWS,
innumerevoli SaaS su Cloudflare. Il rilevamento di outage correlati (2.7)
passerebbe da dire *che* succede a dire *perché*, sei alert collasserebbero in
uno con una causa nominata, e l'Overview si spiegherebbe da sola durante un
disastro grosso. L'idea più interessante non costruita del file, e la più
difficile da non far diventare un progetto di ricerca.

### 11.6 — Suggerire provider da ciò che è installato · M
**Cosa cambia.** Puntare il dialog di aggiunta a un `docker-compose.yml`, un
`package.json` o un `/etc/hosts` e proporre i provider che quello stack implica.
**A cosa serve.** Oggi l'onboarding chiede all'operatore di ricordarsi le
proprie dipendenze; così lo chiede alla macchina.

### 11.7 — Import da Uptime Kuma / Gatus / Statping · S ciascuno
**Cosa cambia.** Un importer per strumento, meccanico.
**A cosa serve.** Chi arriva ha già una lista di cose che guarda, nello YAML o
nel database di qualcun altro. Rimuove l'unica vera barriera a provare IsItDown.

### 11.8 — Sondare da più di un punto · L ⚠️
**Cosa cambia.** Niente, per ora: è in lista perché la domanda resti agli atti.
**A cosa serve.** "La status page dice che è tutto ok ed è giù *per me*" oggi si
può rispondere da un solo punto di vista. Due istanze che si scambiano risultati
di probe sono la federazione (9.6) con un altro cappello; un checker ospitato è
un non-goal.

### 11.9 — Adapter come plugin, riconsiderati · L 🔁
**Cosa cambia.** Gli adapter non sono codice ma *dichiarazioni* — la mappatura
della 11.1, una URL, una tabella di parole-stato — quindi la directory dei
plugin accetta JSON e non esegue mai niente.
**A cosa serve.** La 1.13 non è passata perché un `.js` lasciato cadere gira con
tutti i privilegi del processo. Riformulata così, il rischio sparisce — e gran
parte della domanda di plugin era in realtà domanda della 11.1.

---

## 12. Profondità — ricavare di più da dati già raccolti

Tutto qui gira su righe già presenti nel database. Nessun polling nuovo, nessuna
dipendenza nuova: il costo è analisi e presentazione. Il miglior rapporto
disponibile nel codebase.

### ✅ 12.1 — Annotare la timeline con i propri cambiamenti · S
**Stato.** ✅ `66c94e0`. `POST /annotations`, colore come nome di token, marcatore che sopravvive al provider che nomina.
**Cosa cambia.** `POST /annotations` che accetta timestamp, etichetta e colore,
disegnato come marker su ogni grafico.
**A cosa serve.** Colleghi la pipeline di deploy in una riga e "è colpa della
nostra release o di Cloudflare?" diventa un'occhiata. Minuscolo da costruire, ed
è ciò che un operatore vuole di più durante un incidente.

### ✅ 12.2 — MTTR, MTBF e una classifica di affidabilità · M
**Stato.** ✅ `2ab9838`. `GET /reliability`. MTTR media solo gli incidenti risolti; MTBF è `null` sotto due.
**Cosa cambia.** Per provider: tempo medio di risoluzione, tempo medio tra
incidenti, outage più lungo, trend rispetto al periodo precedente. Una tabella
ordinata, sui dati che la tabella incidenti già contiene (inizio, fine,
severità).
**A cosa serve.** È un documento per gli acquisti: risponde a "quale dei nostri
fornitori è il problema" con prove invece che con ricordi.

### ✅ 12.3 — Incidenti per ora e giorno della settimana · S
**Stato.** ✅ `2ab9838`. Stesso endpoint, `byWeekdayHour`, contato sull'inizio dell'incidente nel fuso dell'operatore.
**Cosa cambia.** Una heatmap su dati già memorizzati, una query.
**A cosa serve.** I provider rilasciano su un calendario e si rompono su un
calendario. Vedere che i guasti di un fornitore si addensano il giovedì sera è
azionabile davvero.

### 12.4 — Error budget con proiezione di consumo · M 🔁
**Cosa cambia.** Un obiettivo mensile per provider, il budget consumato e —
la parte che conta — una proiezione di quando finisce al ritmo attuale.
**A cosa serve.** È la 4.13, posizionata meglio adesso che la 10.6 terrebbe la
coda lunga della storia.

### 12.5 — Il trust score, finalmente calcolabile · M 🔁
**Cosa cambia.** Misurare lo scarto tra lo stato auto-dichiarato di un provider
e quello che il probe ha visto: quante volte, per quanto, in quale direzione.
Va inquadrato come *disaccordo osservato*, mai come accusa.
**A cosa serve.** La 8.1 era speculativa perché niente osservava la realtà in
modo indipendente; i probe (1.8) lo fanno. Nessuno pubblica questo dato, ed è
esattamente il motivo per cui è interessante.

### 12.6 — Export postmortem · S 🔁
**Cosa cambia.** Assemblare note dell'operatore (5.3), timeline e grafici in un
unico file Markdown con la timeline come tabella.
**A cosa serve.** È la 8.7, economica adesso che tutti i pezzi esistono: è
l'artefatto che qualcuno deve scrivere a mano la mattina dopo.

### 12.7 — Cosa è cambiato mentre non c'ero · S
**Cosa cambia.** Un riepilogo scartabile di tutto ciò che è successo dall'ultima
visita — risolto, ancora aperto, appena rotto — letto dai dati che la vista
Incidents già ha.
**A cosa serve.** Aprire la dashboard dopo un weekend oggi dà lo stato corrente
e nessuna narrazione.

### 12.8 — Riassunto incidenti in linguaggio semplice · M ⚠️ 🔁
**Cosa cambia.** Dodici aggiornamenti scarni del provider collassati in una
frase. L'unica versione considerabile è strettamente opzionale, spenta di
default e puntata a un endpoint locale che l'operatore già gestisce.
**A cosa serve.** È la 8.8 e l'obiezione non è cambiata: richiede una chiamata a
un modello, mentre la promessa del progetto è che non serve niente.

### 12.9 — Quanto costa un'outage · S
**Cosa cambia.** L'operatore dichiara un costo orario per provider, e ogni
incidente, il report mensile (4.7) e la classifica di affidabilità (12.2)
portano la cifra accanto alla durata.
**A cosa serve.** Cambia il pubblico dell'export: dalla persona che gestisce lo
strumento alla persona che firma il contratto. Un campo, una moltiplicazione,
effetto sproporzionato.

### 12.10 — Quali provider si rompono insieme, empiricamente · M
**Cosa cambia.** Deriva il grafo della 11.5 dall'evidenza: raggruppa gli
incidenti che si sovrappongono nel tempo su tutta la storia e ordina le coppie
che ricorrono insieme molto più del caso. Non è un'affermazione causale.
**A cosa serve.** È la lista già pronta da dichiarare nella 11.5, e da sola
risponde a "è colpa loro o della cosa che sta sotto di loro".

### 12.11 — "Questo giorno un anno fa" · S 🔁
**Cosa cambia.** Con gli aggregati giornalieri tenuti per sempre (10.6), la
finestra di un anno fa è una singola lettura economica.
**A cosa serve.** È la 8.2, che era speculativa perché nessuno aveva un anno di
dati e un anno di campioni grezzi non sarebbe stato sostenibile. Le domande
aperte sono di prodotto, non tecniche: confronto per data o per giorno della
settimana (gli incidenti seguono i treni di rilascio, non il calendario), quale
numero mostrare (uptime, conteggio incidenti o minuti degradati), e come la
vista dice onestamente che l'anno prima non esiste ancora.

---

## 13. La giornata dell'operatore

La dashboard è completa di funzioni e non è mai stata ottimizzata per i due
stati che contano: cento provider in un giorno normale, e un operatore con un
telefono in mano durante un disservizio.

### ◐ 13.1 — Sopravvivere a cento provider · M
**Stato.** ◐ `694d6c7`. Entrati: ordinamento problemi-primi e toggle di densità (preferenza salvata, oltre la dozzina). I gruppi collassabili per severità esistevano già nella forma densa dell'Overview. **Non entrate: le righe virtualizzate** — le righe della tabella si espandono, portano misure FLIP e un'animazione d'uscita, quindi serve un virtualizzatore ad altezza variabile con le sue misure.
**Cosa cambia.** Gruppi collassabili (la struttura la dà la 2.6), un toggle di
densità, righe virtualizzate e un ordinamento di default che mette i problemi
per primi.
**A cosa serve.** Ogni vista presume una flotta visibile tutta insieme. A 100
l'Overview è uno scroll, la lista regole un pagliaio e la card di confronto
tiene solo due elementi. Il caso di successo dello strumento è oggi la sua vista
peggiore.

### 13.2 — Riconoscere l'alert dalla notifica · M
**Cosa cambia.** Bottoni inline Telegram e componenti Discord che portano *Ack*
e *Mute 2h*. Entrambi entrano come input del diff engine, come ogni mute prima
di loro.
**A cosa serve.** Chiude il ciclo che il log di consegna si limita a osservare,
ed è il 20% utile del chatops (3.18) senza parser di comandi, modello di
sessione o storia di autenticazione.

### 13.3 — Modalità wallboard · M 🔁
**Cosa cambia.** Schermo intero, elementi sovradimensionati, rotazione
automatica, niente cornice, niente interazione: una rotta, un timer di rotazione
e un tema leggibile da lontano.
**A cosa serve.** È la 5.8; i componenti esistono già. Anche la cosa più
fotografabile che il progetto possa produrre.

### 13.4 — Uccidere l'assunzione desktop · M 🔁
**Cosa cambia.** Grafici, tabelle e sezioni impostazioni a 390px, più manifest
PWA e service worker se la 9.5 dice sì.
**A cosa serve.** È la 5.21, ora che la navigazione mobile è in corso.

### 13.5 — Azioni nella command palette · S
**Cosa cambia.** ⌘K (5.4) oltre a navigare *fa*: silenzia un provider, forza un
poll, apre la diagnostica, cambia tema, salta all'ultimo incidente.
**A cosa serve.** La palette è già la superficie più veloce dell'app e oggi si
limita a spostarti.

### 13.6 — Undo, in generale · M
**Cosa cambia.** Uno stack di undo dietro lo stack dei toast, con la scrittura
rinviata di qualche secondo.
**A cosa serve.** La rimozione provider ha una finestra di ripristino ed è la
migliore interazione del prodotto; ogni altra scrittura distruttiva è permanente
e immediata. Generalizzarla rende le impostazioni abbastanza sicure da
esplorare.

### 13.7 — Configurazione in sessanta secondi · M
**Cosa cambia.** Un wizard in tre passi: scegli i provider dal catalogo,
configura un canale, invia una notifica di test vera, fine.
**A cosa serve.** La notifica di test è la prova: uno strumento di monitoraggio
che non ha mai avvisato nessuno non è ancora installato.

### 13.8 — Un passaggio con screen reader · M
**Cosa cambia.** Asserzioni `axe` dentro l'harness visuale esistente, così non
può regredire.
**A cosa serve.** Contrasto e accesso da tastiera sono stati verificati (5.12).
Niente ha verificato cosa annunciano grafici, live region e toast, e una pagina
guidata da SSE è esattamente il posto dove uno screen reader sbaglia.

### 13.9 — Una scheda lasciata aperta una settimana · S
**Cosa cambia.** Un banner quando lo stream è stato giù, e un refetch alla
riconnessione invece di una ripresa.
**A cosa serve.** L'SSE si riconnette, ma una scheda disconnessa a lungo mostra
stato vecchio con piena sicurezza.

### 13.10 — Stati vuoto, caricamento ed errore, revisionati · S
**Cosa cambia.** Un passaggio su ogni vista — nessun provider, nessun incidente,
nessuna storia, backend irraggiungibile — con una baseline visuale ciascuno.
**A cosa serve.** Sono stati scritti una volta, quasi tutti all'inizio, e mai
rivisti come insieme; l'harness (7.1) li rende quasi gratis da mantenere.

### 13.11 — Altre lingue, e una revisione italiana madrelingua · S ciascuna 🔁
**Cosa cambia.** `es`, `fr`, `de`, `pt`, con il gate della 15.6 a impedire che
un catalogo esca tradotto a metà.
**A cosa serve.** Sono la 5.14 e la 5.15: ancora aperte, ancora meccaniche, e
l'estensione di pubblico più economica disponibile.

### 13.12 — Una dashboard composta a widget dall'operatore · L
**Cosa cambia.** Un catalogo di widget già esistenti — griglia flotta, tile
singolo, sparkline uptime, lista incidenti aperti, salute consegne, grafico
latenza, calendario di calore annuale (5.20), composito di gruppo, error budget
(12.4), feed annotazioni (12.1), un contatore, un orologio — e l'Overview
diventa una griglia che l'operatore compone: aggiungi, togli, ridimensiona,
riordina, ogni widget configurato (quale provider, quale finestra, quale gruppo)
e il layout salvato come JSON nel database. Regole che evitano il framework:
ogni widget è un componente esistente con uno schema di props dichiarato, mai un
nuovo percorso di rendering; il layout è dato, non codice; la disposizione di
serie è l'Overview attuale, così chi non apre mai l'editor non vede differenze.
**A cosa serve.** Le flotte non si somigliano: chi guarda otto fornitori vuole
gli incidenti in cima, chi gestisce cento probe vuole un muro di tile. È anche
prerequisito di 13.3 e 17.2, che sono "gli stessi widget, resi altrove".

### 13.13 — Più di una dashboard · M
**Cosa cambia.** Dashboard con nome, commutabili dalla barra laterale, una
marcata come default.
**A cosa serve.** Appena esiste la 13.12, una griglia sola è troppo poco: *il mio
stack* e *i fornitori che pago* vogliono pagine diverse, e un incidente vuole una
pagina con solo i provider coinvolti.

### 13.14 — Ogni widget è una porta · S
**Cosa cambia.** Cliccare un widget porta alla vista corrispondente con i filtri
già applicati: un widget latenza apre History su quel provider e quella
finestra, un conteggio incidenti apre la ricerca (5.19) con la stessa query.
**A cosa serve.** Un widget mostra un numero e la domanda successiva è sempre
*quali righe*. Senza questo la dashboard composta è un poster; con questo è la
porta d'ingresso.

### 13.15 — Un tour guidato alla prima apertura · M 🔁
**Cosa cambia.** Alla prima apertura, un tour breve sulla UI reale — coach mark
ancorati alla barra, a un tile provider, alla timeline incidenti, al selettore di
finestra della storia, al log di consegna e all'ingresso impostazioni — un passo
per superficie, una frase che dice a quale domanda risponde, *Salta* su ogni
passo, nessun modale non chiudibile. Regole anti-marciume: i passi sono dati (una
lista ordinata di `{ anchor, chiave i18n }`), ogni stringa è una chiave di
catalogo come le altre (mai un literal, vedi `i18n-strings`), le ancore sono
attributi `data-tour` su componenti già esistenti e non un DOM parallelo solo per
il tour, e un'ancora mancante salta il suo passo invece di lasciare una card che
punta al nulla. Il "già visto" è un flag nello store impostazioni, non in
`localStorage`, così segue l'istanza e non il browser, e
**Impostazioni → Rivedi il tour** lo rende ripetibile — che è anche il modo in cui
ottiene una baseline visuale (7.1).
**A cosa serve.** La 13.7 configura l'operatore; niente poi gli mostra cosa ha
configurato. Il wizard prova che lo strumento notifica, il tour spiega la
schermata che gli restituisce.

---

## 14. Notifiche che si meritano l'interruzione

La macchina di consegna è fatta: routing, quiet hours, digest, cap, retry, dead
letter, modifiche in place. Manca tutto ciò che sta intorno alla *fiducia*:
sapere come sarà un messaggio, che è arrivato, e che qualcuno se ne è occupato.

### ✅ 14.1 — Anteprima del messaggio reale di ogni canale · S
**Stato.** ✅ `2db60e7`. `GET /notifications/preview`, dalle stesse funzioni pure dei notifier. Un canale strutturato mostra le parti, mai un mock-up della sua struttura.
**Cosa cambia.** Rendere tutti i canali configurati affiancati, da una sola
transizione finta.
**A cosa serve.** Le impostazioni sanno mandare un test e le regole di routing si
spiegano, ma niente mostra il testo renderizzato per canale prima che sia reale.
Elimina il ciclo "configura e aspetta un'outage per scoprirlo".

### 14.2 — Template dei messaggi · L 🔁
**Cosa cambia.** La versione stretta della 3.15: oggetto e corpo per canale
costruiti da un insieme fisso e documentato di token, validati al salvataggio,
con il template di default visibile e modificabile. Nessuna espressione, nessun
condizionale.
**A cosa serve.** L'obiezione originale resta valida — un linguaggio di template
è un piccolo linguaggio di programmazione con un problema di escaping — ma la
versione a soli token dà il controllo senza il rischio.

### 14.3 — Locale per canale · S 🔁
**Cosa cambia.** Un campo per canale, risolto attraverso il catalogo core.
**A cosa serve.** È la 3.20: i cataloghi esistono e la dashboard già commuta, ma
le notifiche sono solo in inglese.

### 14.4 — Escalation quando nessuno risponde · M
**Cosa cambia.** Se un cambiamento major resta non riconosciuto dopo N minuti,
viene rimandato su un canale diverso. Sta nella politica di consegna accanto a
quiet hours e cap, mai vicino al poller.
**A cosa serve.** Dipende dalla 13.2 per il riconoscimento, e chiude il caso "il
messaggio è partito e nessuno l'ha letto".

### 14.5 — Dimmi quando un canale è rotto · S
**Cosa cambia.** La salute dei canali entra nell'auto-monitoraggio della 10.11,
così il silenzio viene annunciato.
**A cosa serve.** Un webhook il cui ricevitore dà 500 da una settimana appare
solo come badge nel log di consegna: l'operatore deve accorgersi di un'assenza.

### 14.6 — Una persona, due canali, un messaggio · M
**Cosa cambia.** Un concetto di *destinatario* che attraversa i canali, con un
canale preferito e gli altri come fallback.
**A cosa serve.** Chi sta sia su Telegram sia su Discord riceve tutto due volte,
quindi ne silenzia uno e perde la ridondanza. È l'unico pezzo di struttura che
manca davvero al livello notifiche.

### 14.7 — Seguire un singolo incidente · S
**Cosa cambia.** Un bottone nella vista incidente per seguirlo fino alla
risoluzione senza toccare le regole di routing.
**A cosa serve.** Il percorso di modifica in place (3.19) traccia già il
messaggio; questo decide chi altro lo riceve.

### 14.8 — Una suite di contratto per i notifier · M
**Cosa cambia.** Una suite che ogni notifier deve passare: mai un throw su
payload ben formato, errore tipizzato su risposta non-2xx, troncamento al limite
del canale, chiave di dedup stabile per tutta la vita del cambiamento, rendering
sia del corpo semplice sia di quello ricco.
**A cosa serve.** Il kit di contratto degli adapter (1.11) ha reso ogni adapter
più economico e sicuro; i notifier non hanno l'equivalente e sono diciotto. Va
scritta prima della 14.2, che moltiplica la superficie.

### 14.9 — Avvisami prima della manutenzione, non durante · S
**Cosa cambia.** Una notifica singola con anticipo configurabile — "manutenzione
GitHub tra due ore" — sui dati già presenti nel database.
**A cosa serve.** Le finestre programmate sono già lette, mostrate e usate per
silenziare il diff engine (2.1), ma l'operatore le scopre solo quando iniziano. È
l'unico alert che permette di agire prima invece di reagire.

### 14.10 — Dire perché questo provider conta · S
**Cosa cambia.** Una riga di testo libero e un responsabile per provider,
portati in ogni canale e mostrati nella pagina di dettaglio (5.6).
**A cosa serve.** Alle 3 di notte la frase utile non è il nome del provider ma
*cosa si rompe da noi quando è giù*. Nessuna logica, due colonne, e un alert
diventa una nota di consegna.

---

## 15. Tenerlo acceso per anni

Il packaging è uscito bene: immagini, Helm, Unraid, binario singolo, artefatti
firmati. La parte non esaminata è il tempo: upgrade, migrazioni, deriva, e il
giorno in cui una status page cambia forma senza dirlo a nessuno.

### 15.1 — Un canarino notturno contro il mondo reale · M
**Cosa cambia.** Un job CI schedulato che interroga le status page vere,
confronta la forma con i fixture committati e apre una issue quando deriva.
Fuori dalla suite di test, mai bloccante per una build.
**A cosa serve.** I test non toccano provider vivi, ed è giusto. Ma un adapter si
rompe quando *qualcun altro* cambia il suo JSON, e oggi nessuno se ne accorge
prima di un utente. La riga operativa di valore più alto del file.

### 15.2 — Migrazioni con una via di ritorno · M
**Cosa cambia.** Un runner di migrazioni numerate con percorso di down, backup
pre-upgrade obbligatorio, e rifiuto di partire su un database più nuovo del
binario.
**A cosa serve.** Quel rifiuto è esattamente ciò che serve quando qualcuno fa
rollback di un'immagine. Si abbina alla 10.9.

### 15.3 — Riconciliare l'edizione UI da file · L
**Cosa cambia.** Osservare un `config.yml` montato opzionale e riconciliare il
database verso di esso, con le righe gestite da file in sola lettura nella
dashboard.
**A cosa serve.** Le due edizioni divergono sulla configurazione: file per Light,
SQLite per UI. Sempre più homelabber vogliono l'istanza UI dichiarata in Git. Il
percorso di import (4.3) ha già dimostrato che le forme sono compatibili.

### 15.4 — Rootless, read-only, distroless · S
**Cosa cambia.** Utente non root, root filesystem in sola lettura con un solo
volume scrivibile, base più piccola. Nessun tocco al codice applicativo.
**A cosa serve.** Oggi l'immagine gira come root su un filesystem scrivibile con
uno userland completo; queste tre cose chiudono quasi tutto ciò che un operatore
attento alla sicurezza chiederebbe.

### 15.5 — Segreti da file, non solo dall'ambiente · S
**Cosa cambia.** Accettare `*_FILE` per ogni segreto.
**A cosa serve.** I segreti Docker e Kubernetes arrivano come file, mentre lo
store credenziali è env-var-e-dashboard. È la convenzione che ogni strumento
vicino già segue.

### 15.6 — Un gate di copertura traduzioni · S
**Cosa cambia.** Build che fallisce se una chiave presente in `en` manca
altrove, e report delle chiavi che nessun codice usa.
**A cosa serve.** `check:readme` protegge la documentazione; niente protegge i
cataloghi. Prerequisito della 13.11.

### 15.7 — Backup schedulati su un path montato · S
**Cosa cambia.** Espressione cron, directory di destinazione, numero di copie da
tenere: `VACUUM INTO` su un timer.
**A cosa serve.** Il backup esiste come download (4.4); la versione non
presidiata è quella che serve davvero.

### 15.8 — Un inviluppo di risorse dichiarato · S
**Cosa cambia.** Pubblicare memoria misurata, crescita del database per provider
al mese e CPU per ciclo a 10 / 100 / 500 provider.
**A cosa serve.** Il load test (7.4) ha provato che 200 provider reggono, ma
nulla dice cosa provisionare. Trasforma "girerà sul mio Pi" in una tabella.

### 15.9 — Proxy e funzionamento air-gapped · S
**Cosa cambia.** Rispettare `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` ovunque (un
solo helper HTTP, quindi una sola modifica) e documentare cosa degrada senza
uscita di rete.
**A cosa serve.** Reti aziendali e homelab passano entrambe da proxy.

### 15.10 — Unit systemd e formula Homebrew · S ciascuna
**Cosa cambia.** Un unit file e una formula, un pomeriggio ciascuno.
**A cosa serve.** Il binario singolo (6.7) non ha packaging intorno, e queste due
cose raggiungono chi non userà mai Docker.

### 15.11 — Dire quando esiste una versione più nuova · S ⚠️
**Cosa cambia.** Un controllo silenzioso sulla lista tag GHCR, un badge nelle
impostazioni, nessun auto-update e nessuna telemetria in uscita — e spento di
default.
**A cosa serve.** Un'istanza self-hosted resta com'è finché qualcuno si ricorda
di fare pull. Spento di default perché uno strumento che telefona a casa senza
invito contraddice la promessa, anche quando la chiamata è innocua.

---

## 16. Macchina della qualità

Il parco test è insolitamente buono — suite di contratto, mutation testing,
baseline visuali, soglie di coverage, un load test. Queste righe chiudono i
buchi che quel parco non copre ancora.

### 16.1 — Asserire che l'API corrisponda alla sua spec · M
**Cosa cambia.** Un contract test guidato dal documento OpenAPI (4.10): ogni
rotta documentata esiste, risponde nella forma documentata e rifiuta ciò che lo
schema dice di rifiutare.
**A cosa serve.** La spec è scritta a mano, quindi devierà di sicuro; senza
questo è documentazione che mente con autorità.

### 16.2 — Test property-based sul diff engine · M
**Cosa cambia.** Generare sequenze di stato casuali e asserire invarianti: mai
notificare due volte la stessa transizione, mai notificare dentro una finestra
di manutenzione, chiudere sempre un incidente che si è aperto.
**A cosa serve.** Il mutation testing (7.3) prova che i casi esistenti sono
significativi, ma non può inventare il caso a cui nessuno ha pensato. Il diff
engine è l'unico componente dove una risposta sbagliata rara è inaccettabile.

### 16.3 — Un budget di performance sull'API · S
**Cosa cambia.** Asserire un p95 su `/history` e sulla ricerca incidenti contro
l'anno di dati che il load test già costruisce.
**A cosa serve.** Il bundle ha un budget (5.16), i tempi di risposta no: così una
query senza indice non passa in silenzio.

### 16.4 — Caos sullo store · S
**Cosa cambia.** Uccidere il processo a metà scrittura, corrompere una pagina,
riempire il disco, e asserire che il boot successivo dia un errore leggibile e un
percorso di ripristino funzionante.
**A cosa serve.** Completa la 10.10; l'homelab produce tutti e tre i casi con
regolarità.

### 16.5 — Un budget di tempo per la CI · S
**Cosa cambia.** Misurare la durata della pipeline, pubblicarla nel job verify e
trattare una regressione come un difetto.
**A cosa serve.** Unit, integrazione, coverage, visuale, bundle, readme e
mutation: lasciata sola la pipeline arriva a venti minuti e poi diventa qualcosa
che la gente salta.

### 16.6 — Mettere in quarantena i flake invece di ritentarli · S
**Cosa cambia.** Una lista di quarantena con un responsabile e una scadenza.
**A cosa serve.** Le suite visuale e di integrazione sono la casa naturale dei
flake, e l'istinto standard è il retry: così un flake noto non diventa un
fallimento ignorato per sempre.

### 16.7 — Una politica di freschezza delle dipendenze · S
**Cosa cambia.** PR di aggiornamento automatiche con la suite completa come
gate, più una posizione scritta sulle major di Node — il progetto pinna la 24 e
prima o poi dovrà rispondere alla 26.
**A cosa serve.** Le dipendenze sono volutamente poche, il che rende ciascuna
significativa.

### 16.8 — Snapshot dei byte esatti del messaggio di ogni canale · S
**Cosa cambia.** Golden file per canale su un insieme fisso di transizioni,
diffati in CI.
**A cosa serve.** Diciotto notifier costruiscono ciascuno un payload e niente
asserisce che aspetto abbia: una modifica di formattazione può rimodellare un
blocco Slack o una Adaptive Card e se ne accorge solo un operatore. Le baseline
visuali fanno questo per i pixel; le notifiche costano molto meno da catturare.

---

## 17. Speculativo

Stesse regole della sezione 8: interessante, non quotato, elencato perché
un'idea non venga re-inventata da zero tra un anno. Una riga qui è una
conversazione, non un piano.

### 17.1 — Un server MCP sulla flotta
Esporre stato della flotta e storia incidenti come tool interrogabili da un
assistente: "Cloudflare era degradato quando il nostro error rate è salito?".
L'API esiste già, questo è un adattatore sopra. Economico, attuale e
completamente opzionale — l'unico modo in cui appartiene a un progetto la cui
promessa è che non serve niente.

### 17.2 — Un endpoint e-ink
Un PNG della flotta, dimensionato per una cornice e-ink economica, aggiornato a
cadenza. Fascino homelab puro, ~50 righe sopra il renderer wallboard (13.3).

### 17.3 — Anomaly detection sulla latenza
La 8.3 fu scartata per mancanza di dati. La latenza di fetch della status page
(2.8) è ormai registrata su ogni campione, quindi i dati esistono e l'obiezione
diventa statistica invece che pratica. Probabilmente resta una trappola.

### 17.4 — Export verso il formato del vicino
Scrivere la flotta come configurazione Uptime Kuma o Gatus. L'inverso della
11.7, e una cosa genuinamente amichevole: dice che il progetto non vuole
intrappolare nessuno.

### 17.5 — Una telefonata per l'unico alert che conta
Twilio, per il singolo provider la cui outage significa alzarsi dal letto.
PagerDuty (3.7) copre questo per chi ha PagerDuty; la maggior parte di questo
pubblico non ce l'ha.

### 17.6 — Guardare un provider riscrivere il proprio passato
La 8.9, invariata e ancora valida: le status page riscrivono in silenzio gli
incidenti risolti. Salvare la prima versione letta e diffare le successive lo
intercetterebbe. Non è bloccata da niente se non dalla voglia — e diventa quasi
gratis se passano la 10.4 e la 10.8, che è l'argomento a favore di quelle righe.

### 17.7 — Un client da terminale
La 8.4. `isitdown watch` in un pannello. L'API lo supporta, il binario singolo
(6.7) rende banale la distribuzione, nessuno l'ha chiesto.

### 17.8 — Layout condivisibili
Una dashboard 13.12 è JSON, quindi si esporta, si incolla in una issue e si
importa — "ecco il layout che uso per una flotta da 100 provider". Un artefatto
di comunità senza server dietro, l'unico tipo che questo progetto si può
permettere.

### 17.9 — Un widget che è il pannello di qualcun altro
Un widget iframe puntato a un pannello Grafana, così la dashboard committata
(4.14) può stare accanto ai tile nativi. Allettante e un po' pericoloso: rende
la griglia di widget una tela general-purpose, e le tele general-purpose
crescono per sempre.

---

## Cosa farne di questo file

Se da qui uscissero solo tre cose, il caso più forte è per:

1. **10.1** — finché "non osservato" non è distinto da "up", ogni numero di
   uptime nel prodotto è silenziosamente sbagliato, e tutto ciò che ci sta sopra
   eredita l'errore.
2. **15.1** — gli adapter sono il contatto del prodotto con il mondo esterno, e
   oggi niente si accorge quando il mondo esterno cambia forma.
3. **12.1** — una rotta, un marker su un grafico, e la timeline inizia a
   rispondere alla domanda che gli operatori portano davvero.

La sezione 9 non è in quella lista perché produce una decisione, non una
funzione. Dovrebbe comunque venire prima: diverse righe qui sopra sono
dimensionate assumendo che le risposte siano no, e un sì in qualunque punto
della 9 le rimodella.

La scommessa singola più grande del file è la **13.12**, la dashboard a widget
componibili. È marcata L onestamente — un motore di layout è un sottosistema, e
il modo in cui fallisce è noto: smette di essere uno strumento di monitoraggio e
diventa un framework per costruirne uno. Il rischio se lo merita comunque,
perché altre tre righe (13.3 wallboard, 13.13 dashboard multiple, 17.2 e-ink)
sono gli stessi widget resi altrove, e ciascuna è costosa da sola e quasi
gratuita una volta che un widget ha uno schema di props e il layout è un dato.
