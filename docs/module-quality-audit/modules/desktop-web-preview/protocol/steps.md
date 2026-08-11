# Protocol Steps: desktop-web-preview

Reviewer: `codex-sol`  
Independent verifier: `ax-code-glm`  
Date: `2026-08-11`

## Step 1 Scope and Integration Surface

The `desktop-web-preview` unit is centered on `desktop/packages/web/server/lib/preview/proxy-runtime.js`, whose seven exports cover resource-error classification at lines 101-113, navigation policy at 115-166, upstream-path cleanup at 872-876, credential-header removal at 878-885, target normalization at 924-961, response rewriting at 965-1043, and the runtime factory at 1045-1519. `desktop/packages/web/server/index.js:62` imports that factory and lines 1314-1326 attach it to Express and the HTTP server. The focused test imports every export at `desktop/packages/web/server/lib/preview/proxy-runtime.test.js:3-11`. Two UI consumers opt into external targets at `desktop/packages/ui/src/components/layout/ContextPanel-impl.tsx:1237-1244` and `desktop/packages/ui/src/lib/preview/screenshot-capture.ts:552-571`.

## Step 2 Trust Boundaries and Failure Modes

Target creation validates UI authentication and request origin when authentication is enabled (`proxy-runtime.js:1264-1276`), normalizes the requested origin (`proxy-runtime.js:1278-1290`), and returns an opaque target ID while placing the separate token in an HttpOnly, path-scoped cookie (`proxy-runtime.js:1292-1310`). Every proxied request rechecks ID existence, expiry, and cookie equality at `proxy-runtime.js:1086-1109`; HTTP and WebSocket forwarding both remove `cookie`, `authorization`, and `x-openchamber-ui-session` at lines 878-885 and 1353-1361. The external-target guard blocks common private, loopback, link-local, CGNAT, and IPv4-mapped literals (`proxy-runtime.js:887-943`), but its own comment at lines 890-893 correctly records that it does not pin DNS resolution. That is a residual constraint of an explicitly user-selected preview proxy, mitigated by the authenticated local-UI boundary and credential stripping, rather than evidence of a new defect in this pass.

## Step 3 Request and Redirect Correctness

Targets receive cryptographically random IDs and tokens, a minimum 15-second lifetime, and an expiry timestamp (`proxy-runtime.js:1069-1083`). Path rewriting removes the exact selected proxy prefix and only the internal `ocPreview` query field while preserving malformed unrelated query text (`proxy-runtime.js:847-875`); the regression at `proxy-runtime.test.js:236-260` exercises both normal and malformed encodings. For redirects, `rewriteProxyRedirectLocation` creates a new target ID for a changed origin but inherits the original token and expiry, avoiding mutation of the page's existing route (`proxy-runtime.js:1190-1215`). The end-to-end mock at `proxy-runtime.test.js:310-380` proves that the original resource still routes to `127.0.0.1` while the rewritten redirect routes to `example.com`. Invalid/expired/missing-token requests fail before middleware forwarding at `proxy-runtime.js:1468-1478`.

## Step 4 Resource Use and Lifecycle

The target registry is a `Map` swept every 30 seconds, with expired entries deleted and the interval unreferenced so it cannot keep the process alive (`proxy-runtime.js:1046-1067`). Lookup and insertion are constant-time, and the 30-minute default TTL at line 1 bounds ordinary registry retention; there is no runtime `dispose`, which is acceptable because attachment and server lifetime coincide at `desktop/packages/web/server/index.js:1314-1326`. Text responses are fully buffered because `selfHandleResponse` is enabled at `proxy-runtime.js:1317-1322`, then HTML/CSS/JavaScript bodies are decoded and regex-rewritten at 1399-1435. That can transiently duplicate large text assets in memory, but binary responses bypass rewriting at lines 1403-1405 and preview dev-server assets are a bounded interactive workload. The hover bridge also throttles DOM inspection with one animation-frame callback at lines 683-699.

## Step 5 Design and Consistency

Dependency injection in `createPreviewProxyRuntime` (`proxy-runtime.js:1045`) keeps crypto, URL parsing, proxy middleware, and interception mockable; `desktop/packages/web/server/index.js:1314-1326` remains a thin composition point. The principal maintainability weakness is duplication: resource-noise rules exist in normal module code at `proxy-runtime.js:31-113` and again inside the injected bridge at 321-379, while navigation policy appears at 115-166 and again at 383-417. The focused tests at `proxy-runtime.test.js:21-108` and 140-191 exercise the exported copies, not a browser execution of `PREVIEW_BRIDGE_SCRIPT`. I compared both copies and found their shared cases aligned; the bridge intentionally adds Cloudflare-beacon suppression at lines 321-325. Splitting bridge generation or evaluating the injected source in a DOM test would reduce future drift without changing the current contract.

## Step 6 Error Handling and Code Hygiene

The registered nine empty catches are all inside the best-effort browser bridge: parent messaging (`proxy-runtime.js:184-190`), isolation of color-scheme callbacks (223-230), optional theme DOM mutation (281-293), invalid target-origin fallback (404-410), reload failure (451-458), malformed HMR messages (485-492), and URL parsing fallbacks for request rewrites (517-562). None sits in target authorization, token validation, header scrubbing, or the server's upgrade rejection path; server route failures log and return 500 at lines 1311-1314, proxy failures log and return 502 at 1437-1463, and upgrade failures reject at 1486-1509. The finding file `docs/module-quality-audit/modules/desktop-web-preview/findings/AUDIT-desktop-web-preview-empty-catch.md:15-34` appropriately keeps these sites visible as Low deferred hygiene debt until comments or explicit dispositions replace silent syntax.

## Step 7 Test Evidence and Gaps

The 22 focused tests cover framework-noise filtering and ordinary failures (`proxy-runtime.test.js:21-108`), type-specific body rewriting (110-138), navigation decisions (140-191), private-address rejection (193-234), path/query and header hygiene (236-308), and cross-origin redirect isolation (310-380). Missing direct execution includes the injected bridge, target expiry/sweeping, CSP and X-Frame-Options stripping at `proxy-runtime.js:1112-1188`, authenticated failure responses at 1264-1276, and the raw WebSocket upgrade branch at 1480-1513. These gaps matter most for regression confidence around integration behavior; the covered normalization, credential, and redirect assertions nevertheless exercise the highest-risk pure logic and proxy option wiring.

## Step 8 Finding Assessment

The sole registered item is `AUDIT-desktop-web-preview-empty-catch`, marked Low and deferred in `docs/module-quality-audit/modules/desktop-web-preview/findings/AUDIT-desktop-web-preview-empty-catch.md:3-13`; its nine locations match the source at `proxy-runtime.js:190,230,292,408,457,491,529,545,562`. Independent rereading supports retaining that finding: the catches are recoverable bridge operations, but local comments would make the intended fallback behavior auditable. No Critical item exists, so this primary-review lane does not create `protocol/reverify.md`. No additional severity finding was established; the DNS-resolution limitation is already explicit at `proxy-runtime.js:887-893`, and the duplicated bridge logic is recorded as a design/test gap in Steps 5 and 7.

## Step 9 Verification and Exit Evidence

`pnpm --dir desktop/packages/web exec vitest run server/lib/preview/proxy-runtime.test.js` completed successfully with one file and 22 tests passing. `node --check desktop/packages/web/server/lib/preview/proxy-runtime.js` and the same syntax check for `proxy-runtime.test.js` also passed. The review therefore completes all nine steps for `desktop-web-preview` with the existing Low deferral still open, no Critical re-verification artifact required, and explicit follow-up value in executing the injected bridge and WebSocket/CSP paths in future tests.
