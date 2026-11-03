import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile, access } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { chromium, firefox, webkit } from "playwright-core"

// Bound browser/driver startup as well as the worker operation deadlines.
const watchdog = setTimeout(() => {
  console.error("Browser Wasm qualification exceeded 90 seconds")
  process.exit(1)
}, 90_000)
watchdog.unref()

const browserName = process.env.AX_DIFF_WASM_BROWSER ?? "chromium"
const browserType = { chromium, firefox, webkit }[browserName]
if (!browserType) throw new Error(`Unsupported browser: ${browserName}`)
// Tarball qualification serves the actual installed assets, not workspace dist.
const pkg = process.env.AX_DIFF_WASM_PACKAGE_ROOT
  ? pathToFileURL(path.resolve(process.env.AX_DIFF_WASM_PACKAGE_ROOT) + path.sep)
  : new URL("../", import.meta.url)
const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'"
const server = createServer(async (request, response) => {
  response.setHeader("Content-Security-Policy", csp)
  try {
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html")
      response.end("<!doctype html><title>Diff Wasm qualification</title>")
      return
    }
    if (!/^\/(dist|wasm)\/[a-zA-Z0-9_.-]+$/.test(request.url ?? "")) {
      response.writeHead(404).end()
      return
    }
    const file = new URL(request.url.slice(1), pkg)
    response.setHeader("Content-Type", file.pathname.endsWith(".wasm") ? "application/wasm" : "text/javascript")
    response.end(await readFile(file))
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
let browser
try {
  let executablePath = browserName === "chromium" ? process.env.AX_DIFF_WASM_CHROMIUM : undefined
  if (browserName === "chromium" && !executablePath && process.platform === "darwin") {
    const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    try {
      await access(chrome)
      executablePath = chrome
    } catch {}
  }
  browser = await browserType.launch({ executablePath, headless: true })
  const page = await browser.newPage()
  const origin = `http://127.0.0.1:${server.address().port}`
  const requests = []
  page.on("request", (request) => requests.push(request.url()))
  await page.goto(origin)
  const result = await page.evaluate(async () => {
    const { createDuplicateComparator } = await import("/dist/browser.js")
    const comparator = createDuplicateComparator()
    const assert = (condition, message) => {
      if (!condition) throw new Error(message)
    }
    try {
      for (const [before, after] of [
        ["", "中文😀"],
        ["a\r\nb", "a\r\nc\r\n"],
        ["a\n", "a"],
        ["a", ""],
      ]) {
        const preview = await comparator.diff(before, after)
        assert((await comparator.applyHunks(before, preview.hunks)) === after, "diff/hunk byte roundtrip")
      }
      assert(
        (await comparator.applyPatch("a.txt", "a\n", [{ old_lines: ["a"], new_lines: ["b"] }])) === "b\n",
        "patch chunks",
      )
      const groups = await comparator.compare(
        [
          ["a", "b"],
          ["a", "b", "c"],
          ["b", "c"],
        ],
        0.6,
      )
      assert(JSON.stringify(groups) === JSON.stringify([{ indices: [0, 1], score: 2 / 3 }]), "greedy parity")
      const unicode = await comparator.compare(
        [
          ["😀", "中文"],
          ["中文", "😀"],
        ],
        1,
      )
      assert(unicode[0]?.score === 1, "Unicode parity")
      const rows = Array.from({ length: 10000 }, (_, i) => Array.from({ length: 20 }, (_, j) => `${i}-${j}`))
      const controller = new AbortController(),
        reason = new Error("browser abort")
      const pending = comparator.compare(rows, 0.9, { signal: controller.signal })
      const cancelled = pending.then(
        () => false,
        (error) => error === reason,
      )
      setTimeout(() => controller.abort(reason), 5)
      assert(await cancelled, "interrupt active Wasm with exact abort reason")
      assert((await comparator.compare([[], []], 1))[0]?.score === 1, "recreate after cancellation")
      const timed = await comparator.compare(rows, 0.9, { timeoutMs: 1 }).then(
        () => false,
        (error) => /timed out/.test(error.message),
      )
      assert(timed, "deadline stops computation")
      assert((await comparator.compare([], 1)).length === 0, "recreate after timeout")
      await comparator.close()
      assert(
        await comparator.compare([], 1).then(
          () => false,
          (error) => /closed/.test(error.message),
        ),
        "closed admission",
      )
      return {
        backend: comparator.backend,
        crossOriginIsolated,
        parity: true,
        cancellation: true,
        timeout: true,
        recovery: true,
      }
    } finally {
      await comparator.close()
    }
  })
  assert.equal(result.crossOriginIsolated, false)
  assert(requests.every((url) => url.startsWith(origin + "/")))
  console.log(
    JSON.stringify(
      {
        engine: browserName,
        browser: await browser.version(),
        csp,
        result,
        requests: requests.length,
        package: fileURLToPath(pkg),
        notes: "Real browser module worker, no shared memory or COOP/COEP; separate test page, Wiki CSP unchanged.",
      },
      null,
      2,
    ),
  )
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
  clearTimeout(watchdog)
}
