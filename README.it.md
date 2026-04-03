<p align="center">
  <a href="https://ax-code.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Logo ax-code">
    </picture>
  </a>
</p>
<p align="center">L’agente di coding AI open source.</p>
<p align="center">
  <a href="https://ax-code.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/ax-code-ai"><img alt="npm" src="https://img.shields.io/npm/v/ax-code-ai?style=flat-square" /></a>
  <a href="https://github.com/defai-digital/ax-code/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/defai-digital/ax-code/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![ax-code Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://ax-code.ai)

---

### Installazione

```bash
# YOLO
curl -fsSL https://ax-code.ai/install | bash

# Package manager
npm i -g ax-code-ai@latest        # oppure bun/pnpm/yarn
scoop install ax-code             # Windows
choco install ax-code             # Windows
brew install anomalyco/tap/ax-code # macOS e Linux (consigliato, sempre aggiornato)
brew install ax-code              # macOS e Linux (formula brew ufficiale, aggiornata meno spesso)
sudo pacman -S ax-code            # Arch Linux (Stable)
paru -S ax-code-bin               # Arch Linux (Latest from AUR)
mise use -g ax-code               # Qualsiasi OS
nix run nixpkgs#ax-code           # oppure github:defai-digital/ax-code per l’ultima branch di sviluppo
```

> [!TIP]
> Rimuovi le versioni precedenti alla 0.1.x prima di installare.

### App Desktop (BETA)

ax-code è disponibile anche come applicazione desktop. Puoi scaricarla direttamente dalla [pagina delle release](https://github.com/defai-digital/ax-code/releases) oppure da [ax-code.ai/download](https://ax-code.ai/download).

| Piattaforma           | Download                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `ax-code-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `ax-code-desktop-darwin-x64.dmg`     |
| Windows               | `ax-code-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, oppure AppImage       |

```bash
# macOS (Homebrew)
brew install --cask ax-code-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/ax-code-desktop
```

#### Directory di installazione

Lo script di installazione rispetta il seguente ordine di priorità per il percorso di installazione:

1. `$AX_CODE_INSTALL_DIR` – Directory di installazione personalizzata
2. `$XDG_BIN_DIR` – Percorso conforme alla XDG Base Directory Specification
3. `$HOME/bin` – Directory binaria standard dell’utente (se esiste o può essere creata)
4. `$HOME/.ax-code/bin` – Fallback predefinito

```bash
# Esempi
AX_CODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://ax-code.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://ax-code.ai/install | bash
```

### Agenti

ax-code include due agenti integrati tra cui puoi passare usando il tasto `Tab`.

- **build** – Predefinito, agente con accesso completo per il lavoro di sviluppo
- **plan** – Agente in sola lettura per analisi ed esplorazione del codice
  - Nega le modifiche ai file per impostazione predefinita
  - Chiede il permesso prima di eseguire comandi bash
  - Ideale per esplorare codebase sconosciute o pianificare modifiche

È inoltre incluso un sotto-agente **general** per ricerche complesse e attività multi-step.
Viene utilizzato internamente e può essere invocato usando `@general` nei messaggi.

Scopri di più sugli [agenti](https://ax-code.ai/docs/agents).

### Documentazione

Per maggiori informazioni su come configurare ax-code, [**consulta la nostra documentazione**](https://ax-code.ai/docs).

### Contribuire

Se sei interessato a contribuire a ax-code, leggi la nostra [guida alla contribuzione](./CONTRIBUTING.md) prima di inviare una pull request.

### Costruire su ax-code

Se stai lavorando a un progetto correlato a ax-code e che utilizza “opencode” come parte del nome (ad esempio “ax-code-dashboard” o “ax-code-mobile”), aggiungi una nota nel tuo README per chiarire che non è sviluppato dal team ax-code e che non è affiliato in alcun modo con noi.

### FAQ

#### In cosa è diverso da Claude Code?

È molto simile a Claude Code in termini di funzionalità. Ecco le principali differenze:

- 100% open source
- Non è legato a nessun provider. Anche se consigliamo i modelli forniti tramite [ax-code Zen](https://ax-code.ai/zen), ax-code può essere utilizzato con Claude, OpenAI, Google o persino modelli locali. Con l’evoluzione dei modelli, le differenze tra di essi si ridurranno e i prezzi scenderanno, quindi essere indipendenti dal provider è importante.
- Supporto LSP pronto all’uso
- Forte attenzione alla TUI. ax-code è sviluppato da utenti neovim e dai creatori di [terminal.shop](https://terminal.shop); spingeremo al limite ciò che è possibile fare nel terminale.
- Architettura client/server. Questo, ad esempio, permette a ax-code di girare sul tuo computer mentre lo controlli da remoto tramite un’app mobile. La frontend TUI è quindi solo uno dei possibili client.

---

**Unisciti alla nostra community** [Discord](https://discord.gg/ax-code) | [X.com](https://x.com/ax-code)
