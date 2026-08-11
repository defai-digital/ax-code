# Review Protocol — ui-components-icon

Unit: `ui-components-icon`  
Reviewer: `codex-sol` (`gpt-5.6-sol-xhigh`)  
Independent verifier: `ax-code-glm`

## Step 1 Scope and public contract

The reviewed runtime surface is the three-file unit rooted at `desktop/packages/ui/src/components/icon`: `IconProps` and the memoized `Icon` component are exported at `desktop/packages/ui/src/components/icon/Icon.tsx:33-37`, `IconName` is exported at `desktop/packages/ui/src/components/icon/icons.ts:1`, and the generated `iconSpriteData` value begins at `desktop/packages/ui/src/components/icon/sprite.ts:4`. The type alias derives its keys from the generated object rather than maintaining a second name list, so a regenerated sprite automatically changes the accepted `name` union. The existing inventory reports the same three sources and four exports at `docs/module-quality-audit/modules/ui-components-icon/MODULE-AUDIT.md:20-34`.

## Step 2 Generation provenance and data boundary

`desktop/packages/ui/src/components/icon/sprite.ts:1-4` identifies the asset as generated and exposes a constant object; its closing `as const satisfies Record<string, string>` at line 232 preserves literal keys while checking all values are strings. The producer reads the installed Remixicon bundle and writes this exact output path at `desktop/scripts/generate-icon-sprite.mjs:17-25`, extracts path `d` values at lines 42-57, and constructs only `<path ... fill="currentColor"/>` fragments at lines 356-390. A structural scan of the checked-in file found 227 entries, no duplicate names, no empty bodies, and path-only markup. The generated markup is therefore a build-time dependency artifact, not runtime user input.

## Step 3 Sprite injection correctness

`ensureSpriteOnce` guards server-side execution and a missing body at `desktop/packages/ui/src/components/icon/Icon.tsx:10-14`, then adopts an already-present node with the fixed ID at lines 16-20. Otherwise it creates an SVG namespace element, fills it with symbols named `oc-${name}`, inserts it before the body's first child, and flips the latch at lines 22-30. This is correct and idempotent for the desktop app's ordinary single-document lifetime. A Low robustness issue remains: the module-level `spriteInjected` flag at line 8 returns before checking the DOM at line 11, so removing the sprite after first render or reusing the module against a replacement document leaves later icons referencing absent symbols. Keying the cache to `document` or rechecking the fixed ID would close that edge case.

## Step 4 Render, props, and accessibility behavior

The component performs injection during render at `desktop/packages/ui/src/components/icon/Icon.tsx:37-42`, then renders one fixed-viewBox SVG and a `<use>` reference at lines 44-53. `cn("remixicon", className)` preserves the base class while accepting consumer sizing and color classes at line 46. Defaults for `viewBox`, namespace, and `aria-hidden` appear before `{...rest}` at lines 47-50, so callers can deliberately override them through standard SVG props; the README correctly documents class-based sizing at `desktop/packages/ui/src/components/icon/README.md:35-43`. The render-time DOM mutation is a Low React-purity advisory because an interrupted or discarded render can still inject the sprite, although the fixed-ID/idempotency guards prevent duplicate nodes in the normal document.

## Step 5 Security and failure model

The only HTML parsing sink is `svg.innerHTML` at `desktop/packages/ui/src/components/icon/Icon.tsx:26-28`. Its value comes exclusively from the statically imported `iconSpriteData` (`Icon.tsx:3`), whose generated entries are literal path fragments (`desktop/packages/ui/src/components/icon/sprite.ts:4-5`) and whose generator escapes the boundary by extracting quoted Remixicon path data rather than accepting application input (`desktop/scripts/generate-icon-sprite.mjs:25-57`). The runtime `name` affects only React's escaped `href` attribute at `Icon.tsx:52` and is compile-time constrained by `IconName` at lines 33-35. No secrets, network calls, process execution, storage access, or error-swallowing path exists in the runtime unit; the static `innerHTML` is not an exploitable user-controlled injection boundary under this provenance.

## Step 6 Performance and resource behavior

The generated table spans `desktop/packages/ui/src/components/icon/sprite.ts:4-232`; the checked-in file is 109,438 bytes with 227 symbols. First use pays one `Object.entries(...).map(...).join("")` plus DOM parse and insertion at `desktop/packages/ui/src/components/icon/Icon.tsx:26-30`, after which the line-11 latch makes subsequent calls constant-time and each icon renders only an SVG plus `<use>` (`Icon.tsx:44-53`). `React.memo` at line 37 also avoids rerendering unchanged icon props. Loading the full sprite instead of per-icon modules is a deliberate fixed startup/DOM cost; for the current 227-entry desktop bundle it is bounded, with no per-render loop after injection.

## Step 7 Design, generated-code hygiene, and documentation

Ownership is compact: rendering and DOM lifecycle remain in `desktop/packages/ui/src/components/icon/Icon.tsx:6-57`, the public key type is a one-line projection in `desktop/packages/ui/src/components/icon/icons.ts:1`, and path data is isolated as generated content in `desktop/packages/ui/src/components/icon/sprite.ts:1-4`. There are no TODO/FIXME markers, catches, logging calls, or manual fallback maps in these three files. One Low documentation defect is concrete: `desktop/packages/ui/src/components/icon/README.md:29-31` says to run `bun run icons:sprite`, while line 55 names `bun run generate-icon-sprite`; neither script exists in `desktop/packages/ui/package.json:14-20`. The executable instruction maintained by the generator itself is `node scripts/generate-icon-sprite.mjs` at `desktop/scripts/generate-icon-sprite.mjs:1-8` when run from `desktop/`.

## Step 8 Tests and verification coverage

The audit records no auto-matched tests at `docs/module-quality-audit/modules/ui-components-icon/MODULE-AUDIT.md:36-37`. The UI Vitest configuration would discover `src/**/*.test.{ts,tsx,js,jsx}` under jsdom (`desktop/packages/ui/vitest.config.ts:19-23`), but no icon-specific test file exists. That leaves SSR no-op behavior (`desktop/packages/ui/src/components/icon/Icon.tsx:12`), existing-sprite adoption (lines 16-20), prop forwarding (lines 45-52), and stale-latch behavior unpinned. As a compile-time check, `pnpm --dir desktop/packages/ui exec tsc --noEmit` completed successfully, validating the `IconName` projection, SVG prop surface, and all current consumers against the checked-in sprite.

## Step 9 Findings and exit decision

This primary review accepts two Low findings: the injection latch can become inconsistent with the active DOM (`desktop/packages/ui/src/components/icon/Icon.tsx:8-18`), and the two documented regeneration commands have no matching package script (`desktop/packages/ui/src/components/icon/README.md:27-31`, `:53-57`; `desktop/packages/ui/package.json:14-20`). Render-time mutation and absent focused tests are non-blocking advisories. The prior register contains no accepted item at `docs/module-quality-audit/modules/ui-components-icon/MODULE-AUDIT.md:51-55`, and the unit's `findings/` directory is empty; this evidence-bearing pass adds no Critical severity item. TypeScript verification passed, so `protocol/reverify.md` is intentionally not created. Independent lane `ax-code-glm` remains responsible for its separate verifier sign-off.
