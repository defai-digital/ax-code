<p align="center">
  <a href="https://ax-code.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="ax-code logo">
    </picture>
  </a>
</p>
<p align="center">Открытый AI-агент для программирования.</p>
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

### Установка

```bash
# YOLO
curl -fsSL https://ax-code.ai/install | bash

# Менеджеры пакетов
npm i -g ax-code-ai@latest        # или bun/pnpm/yarn
scoop install ax-code             # Windows
choco install ax-code             # Windows
brew install anomalyco/tap/ax-code # macOS и Linux (рекомендуем, всегда актуально)
brew install ax-code              # macOS и Linux (официальная формула brew, обновляется реже)
sudo pacman -S ax-code            # Arch Linux (Stable)
paru -S ax-code-bin               # Arch Linux (Latest from AUR)
mise use -g ax-code               # любая ОС
nix run nixpkgs#ax-code           # или github:defai-digital/ax-code для самой свежей ветки dev
```

> [!TIP]
> Перед установкой удалите версии старше 0.1.x.

### Десктопное приложение (BETA)

ax-code также доступен как десктопное приложение. Скачайте его со [страницы релизов](https://github.com/defai-digital/ax-code/releases) или с [ax-code.ai/download](https://ax-code.ai/download).

| Платформа             | Загрузка                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `ax-code-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `ax-code-desktop-darwin-x64.dmg`     |
| Windows               | `ax-code-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm` или AppImage           |

```bash
# macOS (Homebrew)
brew install --cask ax-code-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/ax-code-desktop
```

#### Каталог установки

Скрипт установки выбирает путь установки в следующем порядке приоритета:

1. `$AX_CODE_INSTALL_DIR` - Пользовательский каталог установки
2. `$XDG_BIN_DIR` - Путь, совместимый со спецификацией XDG Base Directory
3. `$HOME/bin` - Стандартный каталог пользовательских бинарников (если существует или можно создать)
4. `$HOME/.ax-code/bin` - Fallback по умолчанию

```bash
# Примеры
AX_CODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://ax-code.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://ax-code.ai/install | bash
```

### Agents

В ax-code есть два встроенных агента, между которыми можно переключаться клавишей `Tab`.

- **build** - По умолчанию, агент с полным доступом для разработки
- **plan** - Агент только для чтения для анализа и изучения кода
  - По умолчанию запрещает редактирование файлов
  - Запрашивает разрешение перед выполнением bash-команд
  - Идеален для изучения незнакомых кодовых баз или планирования изменений

Также включен сабагент **general** для сложных поисков и многошаговых задач.
Он используется внутренне и может быть вызван в сообщениях через `@general`.

Подробнее об [agents](https://ax-code.ai/docs/agents).

### Документация

Больше информации о том, как настроить ax-code: [**наши docs**](https://ax-code.ai/docs).

### Вклад

Если вы хотите внести вклад в ax-code, прочитайте [contributing docs](./CONTRIBUTING.md) перед тем, как отправлять pull request.

### Разработка на базе ax-code

Если вы делаете проект, связанный с ax-code, и используете "ax-code" как часть имени (например, "ax-code-dashboard" или "ax-code-mobile"), добавьте примечание в README, чтобы уточнить, что проект не создан командой ax-code и не аффилирован с нами.

### FAQ

#### Чем это отличается от Claude Code?

По возможностям это очень похоже на Claude Code. Вот ключевые отличия:

- 100% open source
- Не привязано к одному провайдеру. Мы рекомендуем модели из [ax-code Zen](https://ax-code.ai/zen); но ax-code можно использовать с Claude, OpenAI, Google или даже локальными моделями. По мере развития моделей разрыв будет сокращаться, а цены падать, поэтому важна независимость от провайдера.
- Поддержка LSP из коробки
- Фокус на TUI. ax-code построен пользователями neovim и создателями [terminal.shop](https://terminal.shop); мы будем раздвигать границы того, что возможно в терминале.
- Архитектура клиент/сервер. Например, это позволяет запускать ax-code на вашем компьютере, а управлять им удаленно из мобильного приложения. Это значит, что TUI-фронтенд - лишь один из возможных клиентов.

---

**Присоединяйтесь к нашему сообществу** [Discord](https://discord.gg/ax-code) | [X.com](https://x.com/ax-code)
