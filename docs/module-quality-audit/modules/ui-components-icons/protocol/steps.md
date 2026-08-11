# Review Protocol: ui-components-icons

## Step 1 Scope and Surface Inventory

The reviewed surface is the six exported React components listed in `docs/module-quality-audit/modules/ui-components-icons/MODULE-AUDIT.md:24-31`. Each candidate defines one export: `ArrowsMerge` at `desktop/packages/ui/src/components/icons/ArrowsMerge.tsx:3`, `DiffIcon` at `desktop/packages/ui/src/components/icons/DiffIcon.tsx:10`, `FileTypeIcon` at `desktop/packages/ui/src/components/icons/FileTypeIcon.tsx:12`, `FusionIcon` at `desktop/packages/ui/src/components/icons/FusionIcon.tsx:3`, `McpIcon` at `desktop/packages/ui/src/components/icons/McpIcon.tsx:3`, and `StopIcon` at `desktop/packages/ui/src/components/icons/StopIcon.tsx:3`. No barrel or additional source file is part of this unit.

## Step 2 Trust Boundaries and Failure Modes

Five components render fixed SVG geometry and accept only React SVG props; for example, `ArrowsMerge.tsx:5-16` and `McpIcon.tsx:5-17` contain static SVG attributes and paths. `FileTypeIcon` is the only data-dependent surface: `desktop/packages/ui/src/components/icons/FileTypeIcon.tsx:15-19` turns a path and optional extension into an external sprite fragment. The helper constrains the selected name through `FILE_TYPE_ICON_IDS` and a `document` fallback at `desktop/packages/ui/src/lib/fileTypeIcons.ts:203-210`, so caller-controlled paths cannot become arbitrary URLs. There is no process, filesystem, credential, network, or HTML injection operation in these components.

## Step 3 Rendering Correctness and Prop Semantics

The simple icons use valid view boxes and inherit color through `currentColor`; representative evidence is `desktop/packages/ui/src/components/icons/StopIcon.tsx:5-14` and `desktop/packages/ui/src/components/icons/FusionIcon.tsx:5-22`. `DiffIcon` converts numeric sizes to pixels, preserves string sizes, and lets the caller's style override generated width or height at `desktop/packages/ui/src/components/icons/DiffIcon.tsx:10-22`. `FileTypeIcon` selects light only for an explicitly light theme and safely defaults an absent theme provider to dark at `desktop/packages/ui/src/components/icons/FileTypeIcon.tsx:13-15`; `useOptionalThemeSystem` itself is non-throwing at `desktop/packages/ui/src/contexts/useThemeSystem.ts:13-15`.

## Step 4 Performance and Bundle Impact

The fixed icons are leaf render functions without state, effects, iteration, or allocation beyond their SVG element trees, as visible in `desktop/packages/ui/src/components/icons/ArrowsMerge.tsx:3-19` and `desktop/packages/ui/src/components/icons/StopIcon.tsx:3-17`. File-type rendering performs one context read and one resolver call at `desktop/packages/ui/src/components/icons/FileTypeIcon.tsx:13-15`. The roughly 1 MB file-type sprite is deliberately loaded as a Vite asset URL instead of entering the JavaScript bundle (`desktop/packages/ui/src/lib/fileTypeIcons.ts:4-6`), and the component references one symbol with `<use>` (`FileTypeIcon.tsx:18-19`). No material hot-path concern was found.

## Step 5 Component Boundaries and Ownership

SVG presentation remains local to the icon components, while file-name classification and theme-variant selection remain in the shared helper at `desktop/packages/ui/src/lib/fileTypeIcons.ts:170-210`. The generated-sprite contract is documented at `desktop/packages/ui/src/assets/icons/file-types/README.md:7-12`, matching the `<use>` implementation at `desktop/packages/ui/src/components/icons/FileTypeIcon.tsx:18-19`. Consumer code supplies semantic labels on its containing controls—for example the stop button at `desktop/packages/ui/src/components/chat/ChatInput-impl.tsx:733-740`—so these modules do not take over action or localization ownership.

## Step 6 Maintainability and Reachability

The implementations contain no catches, TODO markers, branching duplication, or mutable module state. `cn` merges the default and caller classes for `FileTypeIcon` through `desktop/packages/ui/src/lib/utils.ts:8-10`, used at `desktop/packages/ui/src/components/icons/FileTypeIcon.tsx:18`. A full repository identifier search found `DiffIcon` only at its declaration (`desktop/packages/ui/src/components/icons/DiffIcon.tsx:3-10`), making it an unreferenced cleanup candidate rather than a runtime defect. The other components have live uses, including `ArrowsMerge` at `desktop/packages/ui/src/components/session/sidebar/SidebarHeader.tsx:113-121` and `FusionIcon` at `desktop/packages/ui/src/components/session/sidebar/SessionNodeItem.tsx:889-893`.

## Step 7 Test Coverage and Static Guarantees

No component test is auto-matched for this unit, as recorded at `docs/module-quality-audit/modules/ui-components-icons/MODULE-AUDIT.md:41-42`, and repository searches found no icon-specific test reference. Risk is bounded by typed `SVGProps` contracts (`desktop/packages/ui/src/components/icons/ArrowsMerge.tsx:1-3`), the child-excluding `DiffIconProps` contract (`desktop/packages/ui/src/components/icons/DiffIcon.tsx:3-5`), and the explicit `FileTypeIconProps` fields (`desktop/packages/ui/src/components/icons/FileTypeIcon.tsx:6-12`). The UI package exposes TypeScript, ESLint, and test scripts at `desktop/packages/ui/package.json:14-19`; scoped type and lint checks passed in this review.

## Step 8 Issue Triage and Severity Decision

The existing register contains no accepted issue at `docs/module-quality-audit/modules/ui-components-icons/MODULE-AUDIT.md:56-60`, and there are no files in the unit's `findings/` directory. Independent inspection found no Critical, High, Medium, or Low correctness/security defect. The unused `DiffIcon` export noted from `desktop/packages/ui/src/components/icons/DiffIcon.tsx:10` is maintenance debt only: it has no side effect, bundle entry-point import, or consumer behavior to break. Consequently no Critical second-pass `reverify.md` is required for this reviewer run.

## Step 9 Verification and Exit Decision

`pnpm --dir desktop/packages/ui run type-check` completed successfully using the script declared at `desktop/packages/ui/package.json:17`. A scoped ESLint invocation over all six candidate files also completed with exit code 0 using the configuration wired by `desktop/packages/ui/package.json:18`. The reviewed render paths are exercised by real consumers such as `desktop/packages/ui/src/components/chat/FileAttachment.tsx:132-140` and `desktop/packages/ui/src/components/chat/ChatInput-impl.tsx:733-740`. The primary review for `ui-components-icons` is complete with nine steps, no blocking finding, and the independent verifier role assigned to `ax-code-glm`.
