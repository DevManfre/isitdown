[← README](../README.it.md)

## 13. Deprecazioni

IsItDown cresce aggiungendo, e una superficie che nessuno usa costa comunque una
suite di test, una traduzione e una revisione a ogni modifica che le passa
accanto. Quindi le superfici se ne vanno anche — ma mai di sorpresa (roadmap
16.3). Ognuna:

1. continua a funzionare per **un'intera versione major**, e dice che se ne sta
   andando — nel log, nella dashboard dove vive, e in questa lista;
2. viene rimossa nella major successiva, con una riga nelle note di quel
   rilascio.

Tutto ciò che segue è deprecato dalla **2.46.0** e se ne va nella **3.0.0**.

### 13.1 Cosa è deprecato

| Superficie | Perché | Al suo posto |
|---|---|---|
| Il binario a file singolo della Light (`isitdown-light-vX.Y.Z-linux-x64`, [Docker §4.5](docker.it.md#45-nessuno-dei-due-ledizione-light-in-un-solo-file)) | Circa 35 download in tutti i rilasci finora, e un passo di rilascio tutto suo; l'immagine container della Light fa lo stesso lavoro. | `ghcr.io/devmanfre/isitdown:light-latest`. Fino ad allora il binario scrive un avviso nel log a ogni avvio. |
| `GET /export/history.json` | Nessun link nella dashboard, e ripete ciò che i grafici già leggono. | `GET /history` |
| `GET /export/trust.csv`, `GET /export/trust.json` | Nessun link nella dashboard. | `GET /trust` |
| `GET /export/sla-evidence.json` | Nessun link; la dashboard offre il Markdown. | `GET /export/sla-evidence.md` |
| `GET /export/report-card.json` | Nessun link; la dashboard offre il Markdown. | `GET /export/report-card.md` |
| La vista **Wallboard** (`/wallboard`) | Una pagina ausiliaria senza prove di utilizzo. | L'Overview in una finestra del browser a schermo intero. La vista ora dice che se ne sta andando, in fondo allo schermo. |
| **Installa come app** (Impostazioni → Aspetto) | Lo stesso: una superficie ausiliaria senza prove di utilizzo. | La dashboard in una scheda del browser. Le notifiche web push non cambiano — tengono il loro service worker. |

Una route di export deprecata risponde esattamente come prima, più due header
([RFC 9745](https://www.rfc-editor.org/rfc/rfc9745)) che uno script può
controllare — `Deprecation: @1795046400` e un `Link` a questa pagina con
`rel="deprecation"` — e il server scrive `deprecated export served` nel log una
volta per route per avvio. Il documento OpenAPI segna le cinque route
`deprecated: true`.

### 13.2 Dirci cosa usi

Non c'è telemetria, e non ci sarà. Ciò che decide la prossima lista è ciò che
gli operatori scelgono di dirci, quindi c'è un report fatto apposta: solo
conteggi e identificatori — quanti provider per adapter, quali canali e
funzioni di consegna sono attivi, quali superfici deprecate questa
installazione ha toccato — e mai il nome di un provider, un URL, un token o
qualunque altra cosa che dica di chi è l'installazione.

- **UI:** Impostazioni → Dati → **Report d'uso** → *Copia il report d'uso*. La
  copia aggiunge ciò che sa solo il tuo browser (se hai aperto il wallboard, se
  questa è l'app installata), e *Apri una issue con il report* apre GitHub con
  il report già compilato, da leggere prima di pubblicarlo. Lo stesso JSON,
  senza la parte del browser, è `GET /config/usage-report`.
- **Light:** `node dist/light/check.js --usage [path]` lo stampa per il tuo
  `config.yml`.

Nessuno dei due invia nulla. Se una superficie della lista è una su cui conti,
una issue con il report allegato è il modo per tenerla.
