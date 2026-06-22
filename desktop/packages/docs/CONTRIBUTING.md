# Docs Authoring Guide

This package is docs content source-of-truth for AX Code Desktop.

## Voice & style

Write for someone trying to get something done — not for an engineer reading a
spec. Assume the reader may be non-technical. A page should feel quick to read,
never like a separate chore just to get through one screen.

These rules describe how we already write the docs. Follow them so the style
stays the same no matter who is writing.

### Who you're writing for

- Assume curiosity, not expertise. The reader knows what they want to do, not
  how AX Code Desktop works inside.
- One page = one job. If a page is answering two unrelated questions, split it.

### Keep it short

- Lead with the task, not background. The first line should say what the page is
  for ("Use `ax-code-desktop startup` to launch AX Code Desktop at login.").
- Cut anything that doesn't change what the reader does next.
- A basic page should fit in a screen or two. Long, dense reference pages (like
  Reverse Proxy) are the exception — and they say so in their first line ("Use
  this page if you run AX Code Desktop behind...").

### Steps

- Number sequential actions; use bullets for options or unordered notes.
- Start each step with a verb: "Run", "Open", "Pick".
- End a procedure by telling the reader what success looks like, so they know
  they did it right.

```mdx
3. Run `ax-code-desktop --ui-password be-creative-here`.
4. Open the printed URL (usually `http://localhost:3000`).

You should land on the AX Code Desktop session list. If you see it, the server is
running.
```

### Plain language

- Explain a term the first time it appears, in parentheses, in everyday words.
- Prefer common words over internal ones. "App", "version", "page" beat
  "surface", "instance", "route" when the meaning is the same. If an internal
  term is unavoidable, define it once.
- Don't reach for `SSE`, `WebSocket`, `buffering`, or header names unless the
  page is explicitly an advanced/operator page.

### Bullets and sentences

- Be consistent within a single list. Either all short fragments (lowercase, no
  period) or all full sentences (capital letter, period) — don't mix the two in
  one list.
- Use fragments for quick option lists; use full sentences for rules, warnings,
  or anything the reader must not misread.

### Link out instead of re-explaining

- Where a step can realistically fail, link to
  [Troubleshooting](/troubleshooting/) right there, not only at the bottom.
- Don't re-document something another page owns — link to it. (Quickstart points
  at Install for the actual install command instead of copying it.)

### Show, don't only tell

- A screenshot beats a paragraph for anything visual (where a button is, what a
  screen looks like). See [Images](#images) for how to add one.
- Always pair a screenshot with one line of text — the image supports the step,
  it isn't the whole step.

### Commands and code

- Make code blocks copy-paste-ready: real, working values. Only use a
  `<placeholder>` when the value is genuinely user-specific, and make that
  obvious (e.g. `app.example.com`, `~/.secrets/cf-token`).
- One command per idea. Don't chain unrelated commands just to look compact.

## Add a new docs page

1. Create a new file in `packages/docs/content/docs/`.
   - Example: `packages/docs/content/docs/remote-access.mdx`
2. Add frontmatter at top:

   ```mdx
   ---
   title: Remote Access
   description: Access AX Code Desktop from outside your local network.
   ---
   ```

3. Use route-safe naming:
   - `foo.mdx` -> `/foo/`
   - `folder/index.mdx` -> `/folder/`
   - `folder/bar.mdx` -> `/folder/bar/`
4. Keep the page in English. Do not add localized copies or `translations` maps.
5. Run validation:

   ```bash
   bun run docs:validate
   ```

## Add a new sidebar section

Edit `packages/docs/sidebar.config.json`.

Example:

```json
{
  "label": "Advanced",
  "items": [{ "label": "Remote Access", "link": "/remote-access/" }]
}
```

Rules:

- use trailing slash in links (`/page/`)
- every sidebar link must map to an existing MDX file
- keep section labels short and task-oriented

## Images

Images live inside the docs content tree so they sync to the website with the
pages (the sync copies all of `content/docs/`, not just `.mdx`). Reference them
with a **relative path**; Astro optimizes them at build time.

```
content/docs/
  install.mdx          ->  ![Desktop app](./images/desktop.png)
  images/
    desktop.png
```

Rules:

- co-locate images under `content/docs/` (e.g. `content/docs/images/`); a
  relative `./images/...` reference is resolved and optimized at build
- always set meaningful English `alt` text
- do **not** put docs images in the website repo's `public/` — it is not the
  source of truth and the sync will not pick them up
- keep originals reasonably sized; the build generates responsive variants

`docs:validate` only checks `.mdx`, so images never block validation.

### Light / dark variants

To show a different screenshot per theme, add a `-light` / `-dark` pair and tag
each with `oc-light-only` / `oc-dark-only`. The website ships CSS for these
classes (keyed on Starlight's `data-theme`), so the right one shows and follows
the in-page theme toggle.

Use the `<Image>` component so the images stay optimized while taking a class.
Add the imports right under the frontmatter:

```mdx
---
title: Install
description: ...
---

import { Image } from "astro:assets"
import desktopLight from "./images/desktop-light.png"
import desktopDark from "./images/desktop-dark.png"

<Image src={desktopLight} alt="Desktop app" class="oc-light-only" />
<Image src={desktopDark} alt="Desktop app" class="oc-dark-only" />
```

Notes:

- both files live under `content/docs/` like any other image and sync normally
- give both the same English `alt`
- if you only have one image, just use the normal `![alt](./path.png)` form

## Language Policy

Docs are English only. Do not add locale folders, translated MDX pages, localized
screenshots, or sidebar `translations` maps. Product UI may support additional
languages, but this docs package does not.

### Validate

`bun run docs:validate` walks every `.mdx` under `content/docs/` and fails if any
page is missing `title` or `description` frontmatter, or if a sidebar `link` does
not resolve to a page. Run it after adding or changing pages.

## Sync into the website

The downstream website renders/deploys docs via Starlight in `apps/docs`.

After docs content updates here:

1. copy `packages/docs/content/docs/*` -> `apps/docs/src/content/docs/*`
2. map `packages/docs/sidebar.config.json` into `apps/docs/astro.config.mjs` sidebar
3. run docs checks/build in website repo

Automation support exists in `.github/workflows/docs-source.yml` (release/manual packaging of docs source artifact).
