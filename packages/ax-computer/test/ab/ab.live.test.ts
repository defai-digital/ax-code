// Phase 1a live A/B comparison: runs the shared desktop task set through both
// OCU and Cua against a real target app (TextEdit by default), prints a
// console summary, and writes test/ab/last-report.json only when run live.
//
// Run:
//   AX_COMPUTER_LIVE=1 AX_COMPUTER_OCU_COMMAND=... AX_COMPUTER_CUA_COMMAND=... \
//     pnpm --dir packages/ax-computer exec vitest run test/ab/ab.live.test.ts
// The ocu-vs-axnative block uses AX_COMPUTER_AXNATIVE_COMMAND, or the built
// native/ax-computer-driver binary when the env var is unset.
//
// The "restore TextEdit between providers" step is best-effort: we close the
// document with cmd+w (don't save), then reopen a fresh document with cmd+n.
// The harness does not assert post-restore state — it only attempts to leave
// TextEdit roughly clean for the next run.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { CuaProvider } from "../../src/providers/cua"
import { OcuProvider } from "../../src/providers/ocu"
import { AXNativeProvider } from "../../src/providers/axnative"
import type { ComputerUseProvider } from "../../src/provider"
import { compareAbRuns, formatAbReport, runAbSuite, type AbSuiteRunResult } from "./suite"

const live = process.env.AX_COMPUTER_LIVE === "1"
const liveApp = process.env.AX_COMPUTER_LIVE_APP ?? "TextEdit"

const REPORT_PATH = fileURLToPath(new URL("./last-report.json", import.meta.url))

/**
 * Best-effort restore between providers: observe TextEdit to load a
 * routing context, dismiss any open dialog (escape), close the document
 * (cmd+w), answer "Don't Save" (return on the standard TextEdit
 * confirmation sheet), and open a fresh document (cmd+n). Skipped when
 * the app is anything other than TextEdit, where the key bindings may
 * not match. Errors are swallowed individually so the harness never
 * fails on restore noise.
 */
async function restoreTextEdit(provider: ComputerUseProvider) {
  if (liveApp !== "TextEdit") return
  // ensure the provider has an active observation (ocu currentApp; cua
  // pid/window_id routing) before the keypress sequence — a freshly
  // constructed provider has none
  await provider.observe({ app: liveApp }).catch(() => {})
  // dismiss any stray dialog
  await provider.act({ type: "keypress", keys: ["escape"] }).catch(() => {})
  // close the document — a confirmation sheet appears when there are unsaved changes
  await provider.act({ type: "keypress", keys: ["cmd", "w"] }).catch(() => {})
  await new Promise((r) => setTimeout(r, 500))
  // "Don't Save" is the default button on the sheet
  await provider.act({ type: "keypress", keys: ["return"] }).catch(() => {})
  await new Promise((r) => setTimeout(r, 500))
  // open a fresh, empty document
  await provider.act({ type: "keypress", keys: ["cmd", "n"] }).catch(() => {})
  await new Promise((r) => setTimeout(r, 500))
}

describe.skipIf(!live)("live A/B: ocu vs cua on TextEdit", () => {
  test("AB-001..AB-006 run on both providers; report written to last-report.json", { timeout: 240_000 }, async () => {
    const ocuRun: AbSuiteRunResult = await runAbSuite(
      async () => new OcuProvider({ command: process.env.AX_COMPUTER_OCU_COMMAND }),
      { app: liveApp },
    )

    // restore TextEdit between providers so the cua run starts from a
    // clean document (revert without saving). best-effort: do not let a
    // restore failure abort the test
    await new Promise((r) => setTimeout(r, 500))
    try {
      const restoreProvider = new OcuProvider({ command: process.env.AX_COMPUTER_OCU_COMMAND })
      try {
        await restoreTextEdit(restoreProvider)
      } finally {
        await restoreProvider.dispose().catch(() => {})
      }
    } catch {
      // best-effort; ignore restore failures
    }

    // give the OS a beat to settle between providers
    await new Promise((r) => setTimeout(r, 750))

    const cuaRun: AbSuiteRunResult = await runAbSuite(
      async () => new CuaProvider({ command: process.env.AX_COMPUTER_CUA_COMMAND }),
      { app: liveApp },
    )

    const report = compareAbRuns(ocuRun, cuaRun)

    // console summary (always, even on failure — the human running this
    // command needs to see what happened)
    // eslint-disable-next-line no-console
    console.log("\n" + formatAbReport(report))

    // write last-report.json only on live runs
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))

    // soft assertions: at least the providers made it through the harness
    expect(report.rows).toHaveLength(6)
    expect(report.primary.name).toBe("ocu")
    expect(report.secondary.name).toBe("cua")
  })
})

// Same task set against the AX-owned native driver. Runs only when
// AX_COMPUTER_AXNATIVE_COMMAND (or a built binary) is available live; the
// provider falls back to the built release/debug binary when the env var is
// unset, so no extra wiring is needed after `pnpm build:native`.
describe.skipIf(!live)("live A/B: ocu vs axnative on TextEdit", () => {
  test("AB-001..AB-006 run on both providers", { timeout: 240_000 }, async () => {
    const ocuRun: AbSuiteRunResult = await runAbSuite(
      async () => new OcuProvider({ command: process.env.AX_COMPUTER_OCU_COMMAND }),
      { app: liveApp },
    )

    await new Promise((r) => setTimeout(r, 500))
    try {
      const restoreProvider = new OcuProvider({ command: process.env.AX_COMPUTER_OCU_COMMAND })
      try {
        await restoreTextEdit(restoreProvider)
      } finally {
        await restoreProvider.dispose().catch(() => {})
      }
    } catch {
      // best-effort; ignore restore failures
    }

    await new Promise((r) => setTimeout(r, 750))

    const axnativeRun: AbSuiteRunResult = await runAbSuite(
      async () => new AXNativeProvider({ command: process.env.AX_COMPUTER_AXNATIVE_COMMAND }),
      { app: liveApp },
    )

    const report = compareAbRuns(ocuRun, axnativeRun)
    // eslint-disable-next-line no-console
    console.log("\n" + formatAbReport(report))

    expect(report.rows).toHaveLength(6)
    expect(report.primary.name).toBe("ocu")
    expect(report.secondary.name).toBe("axnative")
  })
})
