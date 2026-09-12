[← README](../README.it.md)

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
- **I componenti shadcn leggono gli stessi token.** `tokens.css` mappa anche le
  variabili semantiche che le primitive shadcn si aspettano — `--background`,
  `--foreground`, `--primary`, `--border`, `--ring` e le altre — su questa palette,
  così un componente shadcn di serie non richiede nessun override per componente per
  adattarsi al design system. La variante `dark:` di Tailwind è ri-legata, tramite
  `@custom-variant`, dalla classe predefinita `.dark` di shadcn all'attributo
  `[data-theme="dark"]` di questo repo, così il toggle del tema esistente — che
  imposta un attributo, non una classe — continua a pilotarlo. Nulla di questo
  tocca lo script di pre-paint qui sotto, che continua a impostare solo
  `data-theme`.
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
| Testo della dashboard | `src/ui/web/locales/<lang>.json` | edizione UI |

`src/core/i18n/` non è toccato dallo stack della dashboard; il server continua a
risolvere da sé le stringhe di notifica, in entrambe le edizioni, esattamente come
prima. La dashboard ora risolve le proprie stringhe tramite `react-i18next`,
configurato con `keySeparator: false` e interpolazione a parentesi singola
(`{name}`, non la `{{name}}` predefinita) — le stesse chiavi piatte
`area.subject.variant` e la stessa sintassi dei placeholder che i cataloghi già
usavano. I plurali usano i suffissi di chiave `_one`/`_other` di i18next, non una
coppia con il punto. I cataloghi sono **incorporati nel bundle, non recuperati via
fetch**: `src/ui/web/lib/i18n.ts` importa entrambi i file JSON direttamente, quindi
viaggiano dentro il bundle JS e `GET /locales/:lang.json` non esiste più come
route.

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
  separate `_one`/`_other`, non composte nel punto di chiamata.
- **Date, numeri, percentuali e durate** passano da `Intl.*` nella lingua attiva. I
  timestamp delle notifiche sono l'eccezione deliberata: sempre UTC con suffisso
  esplicito, così un operatore che legge avvisi in due lingue non deve mai indovinare.
- La lingua della dashboard e quella delle notifiche sono **impostazioni separate**:
  una UI in inglese può mandare avvisi in italiano.
- Aggiungere una lingua di **notifica** è un file JSON sotto `src/core/i18n/` —
  nessuna modifica al codice. Aggiungere una lingua della **dashboard** è un file
  JSON sotto `src/ui/web/locales/` più una riga di import in
  `src/ui/web/lib/i18n.ts`, perché i cataloghi sono incorporati nel bundle invece
  che scoperti da disco a runtime.

In distribuzione: `en` e `it`. La risoluzione della lingua è la preferenza salvata,
poi `en`.

> Le stringhe italiane sono state scritte insieme all'implementazione e non hanno
> avuto una revisione da madrelingua. Vale anche per questo documento.

### 8.3 Accessibilità

La dashboard è la console di un singolo operatore, e quell'operatore può usare
una tastiera, uno screen reader, un'impostazione di contrasto alto, o tutti e tre
(roadmap 5.13). Cosa è garantito, e verificato:

- **Contrasto.** Ogni colore di stato usato come *testo* supera WCAG AA (4.5:1)
  sia sulla pagina sia sulla card, in entrambi i temi — `src/ui/web/css/tokens.test.ts`
  calcola i rapporti da `tokens.css`, così una modifica alla palette che ne rompe
  uno fa fallire la suite invece di essere spedita. L'audit ha trovato due
  difetti reali nel tema scuro: un'interruzione parziale e una grave avevano lo
  stesso colore, e l'*etichetta* di stato leggeva dal grigio quasi-sfondo che
  serve alle barre dei giorni non misurati (1,3:1 — non è testo). Entrambi
  corretti; le barre mantengono quel grigio come token `-fill` separato.
- **Tastiera.** Ogni dialog segue il contratto di Radix — il focus entra
  all'apertura, il Tab resta dentro, Escape chiude, il focus torna al trigger — e
  i dialog accumulati (aggiungi/modifica servizio, rimuovi, diagnostica, regole
  di instradamento) hanno ognuno un test che lo dimostra invece di darlo per
  scontato. Gli elementi cliccabili scritti a mano (una riga di provider, una
  tile ad anello) ricevono un anello di focus visibile da `base.css` a
  specificità zero, sotto quello che una primitiva ha già.
- **Grafici.** Una fila di barre colorate non dice nulla ad alta voce: le barre
  di uptime, la striscia dei componenti, quella dei poll, la sparkline e l'anello
  del provider portano ognuno un riassunto di una frase ("Stato giornaliero su 90
  giorni: 84 operativi, 3 con problemi, 3 non misurati"), nella lingua attiva. Un
  pallino di stato è nascosto all'albero di accessibilità dove lo stato è scritto
  accanto, e porta lo stato a parole dove non lo è.
- **Movimento.** `prefers-reduced-motion: reduce` appiattisce ogni animazione di
  ingresso, spostamento in hover e pulsazione in `motion.css`, e le view che
  animano in JavaScript controllano la stessa query.
