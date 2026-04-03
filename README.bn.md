<p align="center">
  <a href="https://ax-code.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="ax-code logo">
    </picture>
  </a>
</p>
<p align="center">ওপেন সোর্স এআই কোডিং এজেন্ট।</p>
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

### ইনস্টলেশন (Installation)

```bash
# YOLO
curl -fsSL https://ax-code.ai/install | bash

# Package managers
npm i -g ax-code-ai@latest        # or bun/pnpm/yarn
scoop install ax-code             # Windows
choco install ax-code             # Windows
brew install anomalyco/tap/ax-code # macOS and Linux (recommended, always up to date)
brew install ax-code              # macOS and Linux (official brew formula, updated less)
sudo pacman -S ax-code            # Arch Linux (Stable)
paru -S ax-code-bin               # Arch Linux (Latest from AUR)
mise use -g ax-code               # Any OS
nix run nixpkgs#ax-code           # or github:defai-digital/ax-code for latest dev branch
```

> [!TIP]
> ইনস্টল করার আগে ০.১.x এর চেয়ে পুরোনো ভার্সনগুলো মুছে ফেলুন।

### ডেস্কটপ অ্যাপ (BETA)

ax-code ডেস্কটপ অ্যাপ্লিকেশন হিসেবেও উপলব্ধ। সরাসরি [রিলিজ পেজ](https://github.com/defai-digital/ax-code/releases) অথবা [ax-code.ai/download](https://ax-code.ai/download) থেকে ডাউনলোড করুন।

| প্ল্যাটফর্ম           | ডাউনলোড                               |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `ax-code-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `ax-code-desktop-darwin-x64.dmg`     |
| Windows               | `ax-code-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, or AppImage           |

```bash
# macOS (Homebrew)
brew install --cask ax-code-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/ax-code-desktop
```

#### ইনস্টলেশন ডিরেক্টরি (Installation Directory)

ইনস্টল স্ক্রিপ্টটি ইনস্টলেশন পাতের জন্য নিম্নলিখিত অগ্রাধিকার ক্রম মেনে চলে:

1. `$AX_CODE_INSTALL_DIR` - কাস্টম ইনস্টলেশন ডিরেক্টরি
2. `$XDG_BIN_DIR` - XDG বেস ডিরেক্টরি স্পেসিফিকেশন সমর্থিত পাথ
3. `$HOME/bin` - সাধারণ ব্যবহারকারী বাইনারি ডিরেক্টরি (যদি বিদ্যমান থাকে বা তৈরি করা যায়)
4. `$HOME/.ax-code/bin` - ডিফল্ট ফলব্যাক

```bash
# উদাহরণ
AX_CODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://ax-code.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://ax-code.ai/install | bash
```

### এজেন্টস (Agents)

ax-code এ দুটি বিল্ট-ইন এজেন্ট রয়েছে যা আপনি `Tab` কি(key) দিয়ে পরিবর্তন করতে পারবেন।

- **build** - ডিফল্ট, ডেভেলপমেন্টের কাজের জন্য সম্পূর্ণ অ্যাক্সেসযুক্ত এজেন্ট
- **plan** - বিশ্লেষণ এবং কোড এক্সপ্লোরেশনের জন্য রিড-ওনলি এজেন্ট
  - ডিফল্টভাবে ফাইল এডিট করতে দেয় না
  - ব্যাশ কমান্ড চালানোর আগে অনুমতি চায়
  - অপরিচিত কোডবেস এক্সপ্লোর করা বা পরিবর্তনের পরিকল্পনা করার জন্য আদর্শ

এছাড়াও জটিল অনুসন্ধান এবং মাল্টিস্টেপ টাস্কের জন্য একটি **general** সাবএজেন্ট অন্তর্ভুক্ত রয়েছে।
এটি অভ্যন্তরীণভাবে ব্যবহৃত হয় এবং মেসেজে `@general` লিখে ব্যবহার করা যেতে পারে।

এজেন্টদের সম্পর্কে আরও জানুন: [docs](https://ax-code.ai/docs/agents)।

### ডকুমেন্টেশন (Documentation)

কিভাবে ax-code কনফিগার করবেন সে সম্পর্কে আরও তথ্যের জন্য, [**আমাদের ডকস দেখুন**](https://ax-code.ai/docs)।

### অবদান (Contributing)

আপনি যদি ax-code এ অবদান রাখতে চান, অনুগ্রহ করে একটি পুল রিকোয়েস্ট সাবমিট করার আগে আমাদের [কন্ট্রিবিউটিং ডকস](./CONTRIBUTING.md) পড়ে নিন।

### ax-code এর উপর বিল্ডিং (Building on ax-code)

আপনি যদি এমন প্রজেক্টে কাজ করেন যা ax-code এর সাথে সম্পর্কিত এবং প্রজেক্টের নামের অংশ হিসেবে "ax-code" ব্যবহার করেন, উদাহরণস্বরূপ "ax-code-dashboard" বা "ax-code-mobile", তবে দয়া করে আপনার README তে একটি নোট যোগ করে স্পষ্ট করুন যে এই প্রজেক্টটি ax-code দল দ্বারা তৈরি হয়নি এবং আমাদের সাথে এর কোনো সরাসরি সম্পর্ক নেই।

### সচরাচর জিজ্ঞাসিত প্রশ্নাবলী (FAQ)

#### এটি ক্লড কোড (Claude Code) থেকে কীভাবে আলাদা?

ক্যাপাবিলিটির দিক থেকে এটি ক্লড কোডের (Claude Code) মতই। এখানে মূল পার্থক্যগুলো দেওয়া হলো:

- ১০০% ওপেন সোর্স
- কোনো প্রোভাইডারের সাথে আবদ্ধ নয়। যদিও আমরা [ax-code Zen](https://ax-code.ai/zen) এর মাধ্যমে মডেলসমূহ ব্যবহারের পরামর্শ দিই, ax-code ক্লড (Claude), ওপেনএআই (OpenAI), গুগল (Google), অথবা লোকাল মডেলগুলোর সাথেও ব্যবহার করা যেতে পারে। যেমন যেমন মডেলগুলো উন্নত হবে, তাদের মধ্যকার পার্থক্য কমে আসবে এবং দামও কমবে, তাই প্রোভাইডার-অজ্ঞাস্টিক হওয়া খুবই গুরুত্বপূর্ণ।
- আউট-অফ-দ্য-বক্স LSP সাপোর্ট
- TUI এর উপর ফোকাস। ax-code নিওভিম (neovim) ব্যবহারকারী এবং [terminal.shop](https://terminal.shop) এর নির্মাতাদের দ্বারা তৈরি; আমরা টার্মিনালে কী কী সম্ভব তার সীমাবদ্ধতা ছাড়িয়ে যাওয়ার চেষ্টা করছি।
- ক্লায়েন্ট/সার্ভার আর্কিটেকচার। এটি যেমন ax-code কে আপনার কম্পিউটারে চালানোর সুযোগ দেয়, তেমনি আপনি মোবাইল অ্যাপ থেকে রিমোটলি এটি নিয়ন্ত্রণ করতে পারবেন, অর্থাৎ TUI ফ্রন্টএন্ড কেবল সম্ভাব্য ক্লায়েন্টগুলোর মধ্যে একটি।

---

**আমাদের কমিউনিটিতে যুক্ত হোন** [Discord](https://discord.gg/ax-code) | [X.com](https://x.com/ax-code)
