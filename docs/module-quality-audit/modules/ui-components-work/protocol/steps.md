# Review Protocol: ui-components-work

Reviewer: codex-sol  
Independent verifier: ax-code-glm  
Date: 2026-08-11

## Step 1 Scope and public surface

The `ui-components-work` unit is the single component file recorded at `docs/module-quality-audit/modules/ui-components-work/MODULE-AUDIT.md:5-17`. Its sole export is `WorkHome` at `desktop/packages/ui/src/components/work/WorkHome.tsx:75`. The only repository consumer is `desktop/packages/ui/src/components/chat/ChatEmptyState.tsx:10,57-64`, which selects it for the Work desktop surface. `ChatContainer` reaches that consumer both when no session or draft is active and when an idle session has no messages (`desktop/packages/ui/src/components/chat/ChatContainer.tsx:829-840,954-968`). The component's contract is therefore internal UI composition with an optional caller-supplied `className`, not a network or package API.

## Step 2 Trust and failure boundaries

The six starter prompts are fixed i18n keys in `desktop/packages/ui/src/components/work/WorkHome.tsx:13-69`, backed by static English strings at `desktop/packages/ui/src/lib/i18n/messages/en.ts:253-275`; they are not repository or network input. User clicks cross into shared state through `setActiveMainTab` and `openNewSessionDraft` at `WorkHome.tsx:81-86`. Folder selection is requested through the in-memory event fan-out at `desktop/packages/ui/src/lib/sessionEvents.ts:51-59`; the listener mounted by `MainLayout` (`desktop/packages/ui/src/components/layout/MainLayout.tsx:402-408`) opens the dialog at `desktop/packages/ui/src/components/session/SessionDialogs.tsx:218-222`. Project paths originate in the project store and are handed to draft selection at `WorkHome.tsx:149-153`. The component performs no direct filesystem, process, credential, HTML-injection, or network work; React renders titles and prompts as text.

## Step 3 State transition correctness

`startTask` first requests the chat tab and then opens a new draft, carrying a starter prompt only when supplied (`desktop/packages/ui/src/components/work/WorkHome.tsx:81-87`). The draft action atomically opens the draft, clears the current session, and stores the prompt at `desktop/packages/ui/src/sync/session-ui-store.ts:651-667`; it also transfers a non-empty prompt into composer state at `session-ui-store.ts:677-681`. Project rows call `setActiveProject` before invoking either callback (`desktop/packages/ui/src/components/projects/ProjectsHome.tsx:46-60`), so WorkHome's synchronous lookup sees the just-selected project before setting `directoryOverride` (`WorkHome.tsx:142-154`). The main-tab guard can decline a transition at `desktop/packages/ui/src/stores/useUIStore-impl.ts:1511-1520`, but WorkHome is itself reachable only from ChatEmptyState's chat rendering path, so the requested tab is already the active surface. No asynchronous branch, cleanup obligation, or partial mutation exists inside this component.

## Step 4 Render and workload cost

Starter rendering is bounded to the six module-level entries declared at `desktop/packages/ui/src/components/work/WorkHome.tsx:32-69` and mapped once per render at `WorkHome.tsx:116-140`; there is no render-time I/O. The component subscribes to the entire projects array at `WorkHome.tsx:79` although it uses only `projects.length` at `WorkHome.tsx:142`, while `ProjectsHome` separately subscribes to and memo-sorts that array at `desktop/packages/ui/src/components/projects/ProjectsHome.tsx:32-40`. This can cause a small redundant parent render on project metadata changes, but the fixed starter work and already-required child update keep it below a material performance finding. The only downstream asynchronous work, config activation at `desktop/packages/ui/src/sync/session-ui-store.ts:681`, occurs after an explicit task click.

## Step 5 Ownership and component design

WorkHome remains a composition layer: navigation belongs to `useUIStore`, draft resolution belongs to `useSessionUIStore`, project selection belongs to `ProjectsHome`, and directory-dialog ownership remains with `SessionDialogs` (`desktop/packages/ui/src/components/work/WorkHome.tsx:75-87,142-154`; `desktop/packages/ui/src/components/session/SessionDialogs.tsx:218-222`). The Code-surface branch has near-identical project callbacks at `desktop/packages/ui/src/components/chat/ChatEmptyState.tsx:29-41`, while WorkHome repeats them at `WorkHome.tsx:145-153`. That duplication is localized to two surface adapters with different surrounding layouts, so extracting it now would not clearly reduce policy drift. No SDK, persistence, or Electron boundary has leaked into the component.

## Step 6 Accessibility and hygiene

Every actionable element has native button behavior and an explicit `type="button"` at `desktop/packages/ui/src/components/work/WorkHome.tsx:99-112,118-126`; visible text supplies accessible names, and the shared icon implementation marks decorative SVGs hidden at `desktop/packages/ui/src/components/icon/Icon.tsx:44-53`. Starter cards include focus-visible rings at `WorkHome.tsx:122-125`. The title and subtitle are plain spans at `WorkHome.tsx:91-97`, so the visual page title is unavailable to heading navigation; this is a Low accessibility-quality observation rather than a functional blocker. Inspection of the complete unit found no catch block, suppression, TODO/FIXME/HACK marker, unsafe cast, listener, timer, or stale compatibility branch.

## Step 7 Test coverage assessment

The backend workflow files listed as tests in `docs/module-quality-audit/modules/ui-components-work/MODULE-AUDIT.md:31-46` do not import WorkHome. Repository search found no `WorkHome`, `ChatEmptyState`, or `ProjectsHome` component test under the UI package, whose Vitest configuration discovers `src/**/*.test.*` at `desktop/packages/ui/vitest.config.ts:19-23`. The related store suite explicitly limits much of its coverage to the contract layer at `desktop/packages/ui/src/sync/session-ui-store.test.ts:8-17` and does not call `openNewSessionDraft`. Missing focused cases are starter prompt prefilling, blank new-task behavior, folder-event dispatch, conditional project-list rendering, and selected-project directory routing. This is the principal test gap for the unit.

## Step 8 Findings and severity disposition

The existing register contains `_none accepted_` at `docs/module-quality-audit/modules/ui-components-work/MODULE-AUDIT.md:60-64`, and no finding file exists for this unit. This source pass found no Critical, High, or Medium correctness/security defect. It records three Low observations in this protocol: non-semantic title markup (`desktop/packages/ui/src/components/work/WorkHome.tsx:91-97`), a broader-than-needed project-array subscription (`WorkHome.tsx:79,142`), and absent direct interaction coverage (supported by `desktop/packages/ui/vitest.config.ts:19-23` and `session-ui-store.test.ts:8-17`). None establishes user data loss, privilege expansion, crash, or silent failed task creation. Because there is no Critical item, the conditional secondary-confirmation artifact is not required.

## Step 9 Verification and exit

Focused verification on 2026-08-11 passed. `pnpm --filter @openchamber/ui run type-check` completed with no TypeScript diagnostics; the script resolves to `tsc --noEmit` at `desktop/packages/ui/package.json:15-18`. `pnpm --filter @openchamber/ui exec eslint src/components/work/WorkHome.tsx --config ../../eslint.config.js` completed with no lint diagnostics. `pnpm --filter @openchamber/ui exec vitest run src/sync/session-ui-store.test.ts` reported one file and 12 tests passed, using the jsdom setup declared at `desktop/packages/ui/vitest.config.ts:19-23`. That suite supports the downstream store baseline but does not close the component-interaction gaps in Step 7. The nine-step primary review is complete with no Critical gate and no product-source edits.
