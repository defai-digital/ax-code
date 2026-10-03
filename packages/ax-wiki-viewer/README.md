# AX Wiki Viewer

A framework-neutral, browser-safe viewer for recorded Wiki page/source evidence.
No AX Code process, framework peer dependency, CDN, or source-code reader is needed.

```ts
import { mount } from "@ax-code/ax-wiki-viewer"
const view = mount(container, graph)
view.update(nextGraph)
view.dispose()
```

Supply a schema-1 graph from `@ax-code/ax-wiki/graph`. Its validated view is bounded
to 200 nodes and 500 relationships. The graph represents Wiki membership, not code
calls. A new snapshot identity resets selection; invalid updates preserve the
previous view. Hosts can disable style injection with `{ injectStyles: false }`
and provide the exported `viewerCss` themselves.

For a self-contained offline file, Node hosts use `renderWikiGraphHtml(graph)`
from `@ax-code/ax-wiki-viewer/node`. The function returns HTML and its hash-based CSP.
The browser root does not import the Node entrypoint. Data is field-allowlisted;
relative paths and page titles can still be sensitive.

The map offers three switchable views: a force-directed lane layout, a radial
tree (fixed rings per node kind), and a radial cluster (every leaf on the outer
ring). Radial views derive a hierarchy from each file's first citing page and
bundle the remaining cross links toward the center; they never invent branch
lengths. New views are one entry in the view registry plus a layout factory.

Build: `pnpm build`. Check generated assets: `pnpm check:bundle`.
Run unit tests: `pnpm test`. Run browser tests after building: `pnpm test:browser`.
Set `AX_WIKI_CHROMIUM` to a Chromium executable when it is not installed at the
Playwright default location. Browser tests exercise offline CSP, hostile labels,
search/filter, keyboard navigation, mobile layout, and instance disposal.
