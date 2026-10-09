import { BrowserScenario } from "./scenario"

/** Readable regression projection. Only runtime MCP receipts qualify Arena. */
export function exportPlaywright(frozen: BrowserScenario.Frozen): string {
  const quote = (value: unknown) => JSON.stringify(value)
  const locator = (value: BrowserScenario.Locator) =>
    `page.getByRole(${quote(value.role)}, { name: ${quote(value.name)}, exact: true })`
  const steps = frozen.manifest.steps
    .map((step, index) => {
      if (step.action === "contract") return `await checkContract(${quote(step)});`
      if (step.action === "assert") {
        const target = locator(step.assertion.locator)
        const property = step.assertion.property
        const expression =
          property === "count"
            ? `${target}.count()`
            : property === "value"
              ? `${target}.inputValue({ timeout: remaining() })`
              : property === "checked"
                ? `${target}.isChecked({ timeout: remaining() })`
                : `${target}.isDisabled({ timeout: remaining() })`
        const check = `${property === "count" ? "" : `assert.equal(await ${target}.count(), 1, "Step ${index}: unique assertion target");\n    `}assert.equal(await ${expression}, ${quote(step.assertion.equals)}, "Step ${index}: ${property}");`
        return `await checkAssertion(async (remaining) => { ${check} }, ${step.timeoutMs});`
      }
      const target = locator(step.locator)
      return `assert.equal(await ${target}.count(), 1, "Step ${index}: unique action target");\n  await ${target}.${step.action}(${step.action === "fill" ? quote(step.value) : ""});`
    })
    .join("\n  ")
  return `// Browser scenario ${frozen.hash}; runner ${frozen.runner}; baseline ${frozen.baseline.revision}
// Run: AX_TEST_WEBMCP_CHROME=/absolute/path/to/chrome node browser-regression.mjs
// Install playwright-core in this project's development dependencies. No existing browser profile is used.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { chromium } from "playwright-core";
const manifest = ${JSON.stringify(frozen.manifest, null, 2)};
const data = await mkdtemp(join(tmpdir(), "ax-browser-regression-"));
const lease = createServer();
lease.listen(0, "127.0.0.1"); await once(lease, "listening");
const port = lease.address().port;
const origin = "http://127.0.0.1:" + port;
const shellQuote = value => "'" + value.replaceAll("'", "'\\\\''") + "'";
const command = value => value.replaceAll("{port}", String(port)).replaceAll("{data}", shellQuote(data));
const children = new Set();
async function stop(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    await once(killer, "exit");
  } else { try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
  await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 2000))]);
}
function launch(value) {
  const child = spawn(command(value), { shell: true, detached: process.platform !== "win32", stdio: "ignore" });
  children.add(child); return child;
}
async function run(value) {
  const child = launch(value);
  const timer = setTimeout(() => void stop(child), 15000);
  try { const [code] = await once(child, "exit"); assert.equal(code, 0, "Lifecycle command failed"); }
  finally { clearTimeout(timer); await stop(child); }
}
let browser;
const deadline = setTimeout(() => { for (const child of children) void stop(child); void browser?.close(); }, 120000);
try {
  for (const value of manifest.setup) await run(value);
  for (const value of manifest.reset) await run(value);
  await new Promise(resolve => lease.close(resolve));
  const server = launch(manifest.server);
  const readyBy = Date.now() + 15000;
  while (true) {
    if (server.exitCode !== null || Date.now() > readyBy) throw new Error("Test server unavailable");
    // @scan-suppress security_scan - generated test origin is literal 127.0.0.1 plus a leased port; frozen path forbids alternate origins and redirects are errors.
    try { const response = await fetch(origin + manifest.path, { signal: AbortSignal.timeout(1000), redirect: "error" }); if (response.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.AX_TEST_WEBMCP_CHROME, headless: true, args: ["--enable-features=WebMCP"] });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const cdp = await context.newCDPSession(page);
  const pageTools = new Map();
  const responses = new Map();
  cdp.on("WebMCP.toolsAdded", event => {
    for (const tool of event.tools) pageTools.set(tool.frameId + ":" + tool.name, tool);
  });
  cdp.on("WebMCP.toolsRemoved", event => {
    for (const tool of event.tools) pageTools.delete(tool.frameId + ":" + tool.name);
  });
  cdp.on("WebMCP.toolResponded", event => responses.set(event.invocationId, event));
  if (manifest.steps.some(step => step.action === "contract")) await cdp.send("WebMCP.enable");
  const pause = () => new Promise(resolve => setTimeout(resolve, 25));
  const decode = value => { if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return value; } };
  async function checkAssertion(check, timeoutMs) {
    const until = Date.now() + timeoutMs;
    const remaining = () => Math.max(1, until - Date.now());
    while (true) {
      assert.equal(new URL(page.url()).origin, origin, "Scenario page left its origin");
      try { await check(remaining); return; }
      catch (error) {
        if ((error.code !== "ERR_ASSERTION" && error.name !== "TimeoutError") || Date.now() >= until) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(100, until - Date.now()))));
      }
    }
  }
  async function checkContract(step) {
    const { frameTree } = await cdp.send("Page.getFrameTree");
    const frameId = frameTree.frame.id;
    const until = Date.now() + 5000;
    while (!pageTools.has(frameId + ":" + step.name) && Date.now() < until) await pause();
    const tool = pageTools.get(frameId + ":" + step.name);
    assert.ok(tool, "Named page tool unavailable");
    const annotations = tool.annotations ? { readOnly: tool.annotations.readOnly === true, untrustedContent: tool.annotations.untrustedContent === true, consequential: tool.annotations.consequential === true } : null;
    const hash = createHash("sha256").update(JSON.stringify([tool.name, tool.description ?? "", tool.inputSchema ?? null, annotations])).digest("hex");
    assert.equal(hash, step.descriptorHash, "Page-tool descriptor drift");
    const { invocationId } = await cdp.send("WebMCP.invokeTool", { frameId, toolName: step.name, input: step.input });
    while (!responses.has(invocationId) && Date.now() < until) await pause();
    const response = responses.get(invocationId);
    responses.delete(invocationId);
    assert.ok(response, "Page-tool completion missing");
    if (step.expectError) { assert.equal(response.status, "Error"); assert.equal(typeof response.errorText, "string"); return; }
    assert.equal(response.status, "Completed");
    let value = decode(response.output);
    for (const key of step.resultPath) { assert.ok(value && Object.hasOwn(value, key)); value = value[key]; }
    assert.deepEqual(value, step.equals, "Page-tool output differed");
  }
  await page.goto(origin + manifest.path);
  ${steps}
  console.log(JSON.stringify({ scenarioHash: ${quote(frozen.hash)}, status: "pass", oracle: "exported-playwright" }));
} finally {
  clearTimeout(deadline);
  await browser?.close();
  lease.close();
  for (const child of children) await stop(child);
  try { for (const value of manifest.cleanup) await run(value); }
  finally { await rm(data, { recursive: true, force: true }); }
}
`
}

export function registrationTemplate(input: {
  name: string
  module: string
  exportName: string
  schema: Record<string, unknown>
}): string {
  if (!/^[A-Za-z_$][\w$]*$/.test(input.exportName) || !/^\.\.?\/[\w./-]+$/.test(input.module))
    throw new Error("Use an explicit relative application module and named export")
  if (Object.keys(input.schema).length === 0) throw new Error("Provide the application's explicit input schema")
  return `// Review application authorization and validation in the existing function before enabling this registration.\nimport { ${input.exportName} } from ${JSON.stringify(input.module)}\n\nif (typeof document.modelContext?.registerTool === "function") {\n  await document.modelContext.registerTool({\n    name: ${JSON.stringify(input.name)},\n    description: "Application-owned action; validate inputs and enforce authorization in the application function.",\n    inputSchema: ${JSON.stringify(input.schema, null, 2)},\n    annotations: { consequentialHint: true },\n    execute: (input) => ${input.exportName}(input),\n  })\n}\n`
}
