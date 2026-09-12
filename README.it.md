<p align="center">
  <img src="docs/img/social-preview.png" alt="IsItDown" width="880">
</p>

[![Release](https://img.shields.io/github/v/release/DevManfre/isitdown?style=flat-square)](https://github.com/DevManfre/isitdown/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/DevManfre/isitdown/ci.yml?branch=main&style=flat-square&label=CI)](.github/workflows/ci.yml)
[![Licenza](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2024-5FA04E?style=flat-square&logo=node.js&logoColor=white)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](tsconfig.json)
[![Dashboard](https://img.shields.io/badge/dashboard-react-61DAFB?style=flat-square&logo=react&logoColor=black)](docs/development.it.md#92-stack-tecnologico)

[![Dipendenze runtime](https://img.shields.io/badge/runtime%20deps-3-lightgrey?style=flat-square)](docs/development.it.md#92-stack-tecnologico)
[![Docker](https://img.shields.io/badge/docker-light%20%7C%20ui-2496ED?style=flat-square&logo=docker&logoColor=white)](docs/docker.it.md#4-docker)
[![i18n](https://img.shields.io/badge/i18n-en%20%7C%20it-orange?style=flat-square)](docs/theming.it.md#82-localizzazione)

[English](README.md) · **Italiano**

Monitoraggio self-hosted e containerizzato delle status page **degli altri**.
Interroga le status page pubbliche dei provider da cui dipendi — GitHub, Cloudflare,
Anthropic, npm, qualunque cosa giri su Atlassian Statuspage — e ti avvisa quando uno
di loro cambia stato.

Esiste perché un singolo sviluppatore o un piccolo team abbia un preavviso sui
problemi upstream senza tenere aperte cinque dashboard di stato. Notifica sulle
*transizioni*, mai a ogni poll: una settimana tranquilla è una settimana silenziosa.

Due edizioni dallo stesso codice: **Light** (solo polling e notifiche, nessun
server) e **UI** (lo stesso motore più una dashboard locale, configurabile a runtime).

## Indice

In questa pagina: [1. Cosa fa](#1-cosa-fa) · [2. Avvio rapido](#2-avvio-rapido) ·
[10. Roadmap](#10-roadmap) · [11. Layout dei branch e politica di merge](#11-layout-dei-branch-e-politica-di-merge)

Il manuale, un file per sezione:

- [3. Configurazione](docs/configuration.it.md) — `config.yml`, impostazioni a runtime, segreti, provider, canali, instradamento, politica di consegna
- [4. Docker](docs/docker.it.md) — immagini, profili Compose, volumi e probe, Kubernetes
- [5. Verificare un deployment](docs/verifying.it.md) — controlli rapidi, la dashboard, una notifica end-to-end, risoluzione dei problemi
- [6. API HTTP](docs/api.it.md) — ogni route, le metriche, gli aggiornamenti live, i badge
- [7. Come funziona](docs/how-it-works.it.md) — flusso dei dati, componenti, quando scatta una notifica, resilienza
- [8. Tema e localizzazione](docs/theming.it.md) — temi, `en`/`it`, accessibilità
- [9. Sviluppo](docs/development.it.md) — struttura, stack tecnico, sviluppo live, test, rilasci

Ogni pagina ha accanto la sua gemella inglese (`docs/<nome>.md`).

## 1. Cosa fa

Ogni pochi minuti IsItDown recupera la status page di ogni provider, normalizza
la risposta, la confronta con quella precedente e invia un messaggio solo se è
cambiato qualcosa davvero.

```
GitHub          operational    ████████████████████████████  99.98%
Cloudflare      degraded       ███████████████▁▁▁▁▁████████  99.61%   ← ti arriva un messaggio
Anthropic       operational    ████████████████████████████  99.93%
```

### Principi di base

- **Nessuna dipendenza esterna a runtime.** Nessun database server, nessun broker,
  nessun account cloud. A questa scala bastano un file JSON o un SQLite embedded.
- **Guidato dalla configurazione.** Aggiungere un provider non significa mai
  toccare codice: una voce in `config.yml` (Light) o un dialog nella dashboard (UI).
- **Notifiche idempotenti.** Notificano solo le *transizioni* di stato: operational
  → degraded, degraded → outage, outage → resolved. Un restart non notifica nulla.
- **Indipendente dal provider.** La maggior parte gira su Atlassian Statuspage e non
  richiede codice; per tutto il resto serve un piccolo adapter.
- **Segreti solo dall'ambiente.** Un token si legge da una variabile d'ambiente e
  non viene mai scritto in un file di configurazione, in un database, in una
  risposta API o in una riga di log. L'edizione UI può salvarne uno in un file
  `0600` accanto al database, sempre come variabile, così la dashboard imposta
  una credenziale senza riavvii.

### Le due edizioni

|  | Light | UI |
|---|---|---|
| Immagine | `ghcr.io/devmanfre/isitdown:light-latest` | `…:ui-latest` (costruita `FROM` light) |
| Poller · Adapter · Diff Engine · Notifier | condivisi | condivisi |
| Configurazione | `config.yml`, riletto a ogni ciclo | SQLite, modificata dalla dashboard |
| State store | file JSON, scritture atomiche | SQLite (contiene anche la cronologia) |
| Server HTTP | assente | Express sulla :3000 |
| Cronologia uptime e grafici | — | viste 7/30/90 giorni, più un calendario annuale per provider |
| Tema | — | chiaro / scuro / sistema |
| Localizzazione | testo delle notifiche | testo delle notifiche **e** tutta la dashboard |
| Impronta | immagine 264MB, nessuna porta in ascolto | 267MB: l'immagine Light più un layer |

Entrambe le edizioni eseguono lo stesso motore. Differiscono solo per ciò che viene
iniettato: da dove arriva la configurazione e dove viene tenuto lo stato.

---

## 2. Avvio rapido

### 2.1 Con Docker

**Edizione UI, senza clone** — un file, due comandi. Le immagini sono pubblicate
su GHCR per `linux/amd64` e `linux/arm64`, quindi questo è anche il percorso per
Raspberry Pi, Unraid, Portainer e Synology:

```bash
curl -O https://raw.githubusercontent.com/DevManfre/isitdown/main/docker-compose.yml
docker compose --profile ui up -d
# poi apri http://localhost:3000
```

Tutto ciò che serve all'edizione UI si configura nella dashboard, credenziali
comprese: **Settings → un canale → Valore → Salva** ha effetto subito. Se
preferisci che sia il container a possederle, mettile in un `.env` accanto al
file compose: è opzionale, e viene letto se presente.

```bash
printf 'TELEGRAM_BOT_TOKEN=...\nTELEGRAM_CHAT_ID=...\n' > .env
docker compose --profile ui up -d      # ricrea il container con i token
```

**Edizione Light** — polling e notifiche, niente in ascolto. Questa ha bisogno di
un `config.yml` da montare, quindi si parte da un clone:

```bash
git clone https://github.com/DevManfre/isitdown.git && cd isitdown
cp .env.example .env                # compila solo i canali che abiliterai
cp config.example.yml config.yml    # modifica: provider, intervallo, canali
docker compose --profile light up -d
docker logs -f isitdown-light
```

Possono girare entrambe insieme: usano volumi dati separati.

Chi sviluppa dal sorgente aggiunge `--build`, che ignora il pull e costruisce
l'immagine in locale:

```bash
docker compose --profile ui up -d --build
```

### 2.2 Senza Docker

Richiede **Node 24** sia per la build sia per il runtime: `.nvmrc` lo fissa e
`npm install` rifiuta versioni più vecchie, perché il driver SQLite integrato nel
runtime e il suo supporto TypeScript nativo sono fondamentali anche in fase di
build. `build:ui` in più esegue Vite per pacchettizzare la dashboard; `build:light`
salta questo passaggio, dato che Light non distribuisce nessuna dashboard.

```bash
nvm use                             # oppure: nvm install 24
npm install
cp config.example.yml config.yml
cp .env.example .env

npm run build:light && node dist/light/index.js     # Light
npm run build:ui    && node dist/ui/server.js       # UI, poi apri :3000
```

Variabili utili in locale: `CONFIG_PATH`, `DATA_PATH`, `DB_PATH`, `PORT`,
`LOG_LEVEL` (vedi [3.3](docs/configuration.it.md#33-variabili-dambiente)).

---

## 10. Roadmap

Consegnato:

- **v1 — edizione Light**: polling, diff engine, notifiche Telegram e webhook
  generico, `config.yml` con segreti referenziati dall'ambiente, state store JSON con
  scritture atomiche, `ghcr.io/devmanfre/isitdown:light-latest`.
- **v1.1 — prototipazione UI**: la dashboard esplorata in Claude Design e conservata in
  `design/claude-design-prototypes/`. L'opzione `3a`, la console navigabile, è il
  riferimento per l'implementazione; la palette scura e le etichette italiane più
  lunghe sono state validate lì invece di essere scoperte dopo.
- **v1.2 — edizione UI**: quel design come dashboard Express + moduli ES vanilla su
  SQLite, con la configurazione gestita a runtime e applicata al ciclo successivo senza
  restart. `ghcr.io/devmanfre/isitdown:ui-latest`, costruita `FROM` l'immagine Light.
- **v1.3 — cronologia**: uptime e cronologia incidenti per provider con le barre
  giornaliere in stile status page e le viste 7/30/90 giorni, aggregate lato server e
  servite da `/history`.
- **v1.4 — tema scuro e i18n**: tema chiaro/scuro/sistema basato su token con
  preferenza persistita, e dashboard localizzata (`en`, `it`) sopra i messaggi di
  notifica localizzati che entrambe le edizioni già condividevano.

Dopo la v1.4 (su `dev`): adapter per AWS, Google Cloud e Azure, richieste
condizionali così che la maggior parte dei cicli sia un `304`, una cadenza di
polling per provider, la vista del log invii, una rimozione di provider
annullabile entro una finestra di ripristino, ntfy e Gotify accanto agli altri
canali, un calendario annuale per provider, la readiness separata dalla
liveness, una verifica di integrità con vacuum su richiesta e una dashboard
Grafana committata.

Ancora aperto:

- Una revisione madrelingua delle stringhe italiane.
- Probe HTTP diretti ("il *mio* servizio è su?") e una status page pubblica in sola
  lettura: i due punti che cambiano cosa è IsItDown, elencati in `ROADMAP.md`.

Non-obiettivi espliciti: autenticazione multi-utente (questa è una dashboard locale per
un singolo operatore), status page dietro login, e un'app mobile pacchettizzata.

---

## 11. Layout dei branch e politica di merge

Il tooling di Claude Code (`.claude/`, `CLAUDE.md`) e il filtro di merge stesso
(`.mergeexclude`, `.githooks/`, `scripts/`) sono versionati **solo su `dev`**. Su
`main` nessuno di quei percorsi esiste, né nel commit né nel working tree. Tutto il
resto (sorgenti, documentazione, configurazione) passa normalmente da `dev` a `main`.

Poiché il filtro non è leggibile da `main`, viene installato nella directory `.git` di
questo clone, che tutti i branch condividono.

### Setup, una volta per clone

```bash
git switch dev
scripts/setup-hooks.sh
```

Copia:

| Da (`dev`) | A (condiviso da ogni branch) |
|---|---|
| `scripts/git-merge-clean` | `$GIT_DIR/merge-clean` |
| `.githooks/*` | `$GIT_DIR/hooks/*` |
| `.mergeexclude` | `$GIT_DIR/merge-exclude` |

e installa l'alias `git mergeclean`. Rieseguilo dopo aver modificato `.mergeexclude`
o `scripts/git-merge-clean`.

### Merge verso `main`

```bash
git switch main
git mergeclean dev        # non `git merge dev`
```

`git mergeclean` fa il merge del branch, elimina i percorsi elencati nella lista di
esclusione, committa col formato di subject `🔀` del repository e rimuove quei percorsi
dal working tree. Si rifiuta di partire su un albero sporco. I conflitti veri fuori dai
percorsi esclusi fermano l'esecuzione così puoi risolverli e fare `git commit` come al
solito.

### Cosa lo fa rispettare

| Pezzo | Ruolo |
|---|---|
| `$GIT_DIR/merge-exclude` | la lista dei percorsi |
| `$GIT_DIR/merge-clean` | il wrapper di merge (`--sync` elimina, `--guard` controlla) |
| `$GIT_DIR/hooks/post-checkout` | elimina i percorsi esclusi dopo un cambio di branch |
| `$GIT_DIR/hooks/pre-merge-commit`, `pre-commit` | interrompono qualunque commit che aggiungerebbe un percorso escluso a un branch che non lo traccia |

Un `git merge dev` semplice su `main` viene rifiutato dagli hook di guardia: esegui
`git merge --abort` e usa `git mergeclean`. `git commit --no-verify` aggira la guardia
se ti serve davvero.

### Conseguenze del tenere il filtro fuori da `main`

- **Il setup è per clone e non può essere automatico.** Git non esegue mai hook presi
  da un clone, e un clone che fa checkout solo di `main` non ha nulla da cui
  installare. Su una macchina nuova, fai checkout di `dev` ed esegui il setup prima di
  fare merge verso `main`.
- **Finché il setup non viene eseguito, non è imposto nulla.** Un `git merge dev`
  semplice su un clone appena fatto porterà `.claude/` e `CLAUDE.md` dentro `main`
  appena risolvi i conflitti che solleva.

### Regole pratiche

- Modifica `.claude/`, `CLAUDE.md`, `.mergeexclude`, `.githooks/` e `scripts/` solo
  stando su `dev`: su `main` non esistono.
- L'eliminazione cancella solo i file che anche `dev` ha e che sono identici byte per
  byte, quindi i file locali della macchina (`.claude/settings.local.json`) e le
  modifiche locali non vengono mai toccati.
