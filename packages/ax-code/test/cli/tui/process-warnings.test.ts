import { EventEmitter } from "node:events"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, test } from "vitest"
import {
  allowTuiComponentListeners,
  restoreProcessWarnings,
  routeProcessWarningsToLog,
  TUI_COMPONENT_LISTENER_LIMIT,
} from "../../../src/cli/tui/process-warnings"
import { Log } from "../../../src/util/log"

Log.init({ print: false })

// Node's default listener limit; one more than this used to print a warning over the prompt.
const NODE_DEFAULT_LISTENER_LIMIT = 10

afterEach(() => {
  restoreProcessWarnings()
})

describe("TUI process warnings", () => {
  test("per-component keyboard and resize listeners stay under the bound", async () => {
    const renderer = Object.assign(new EventEmitter(), { keyInput: new EventEmitter() })
    allowTuiComponentListeners(renderer)

    const warnings: Error[] = []
    const collect = (warning: Error) => warnings.push(warning)
    process.on("warning", collect)
    try {
      for (let index = 0; index < NODE_DEFAULT_LISTENER_LIMIT * 3; index++) {
        renderer.on("resize", () => {})
        renderer.keyInput.on("keypress", () => {})
      }
      // Warnings are emitted on a later tick.
      await new Promise((resolve) => setImmediate(resolve))
    } finally {
      process.off("warning", collect)
    }
    expect(warnings).toEqual([])
    expect(renderer.getMaxListeners()).toBe(TUI_COMPONENT_LISTENER_LIMIT)
    expect(renderer.keyInput.getMaxListeners()).toBe(TUI_COMPONENT_LISTENER_LIMIT)
  })

  test("routing detaches Node's printer and restoring puts it back", () => {
    const printers = () => process.listeners("warning").filter((listener) => listener.name === "onWarning")
    const before = printers()
    const restore = routeProcessWarningsToLog()
    expect(printers()).toEqual([])
    // A second route (re-render) must not lose the saved printer.
    routeProcessWarningsToLog()
    restore()
    expect(printers()).toEqual(before)
    restore()
    expect(printers()).toEqual(before)
  })

  test("a routed warning never reaches the terminal", () => {
    const moduleUrl = new URL("../../../src/cli/tui/process-warnings.ts", import.meta.url).href
    const script = `
      const { routeProcessWarningsToLog } = await import(${JSON.stringify(moduleUrl)})
      const { EventEmitter } = await import("node:events")
      const routed = process.env.AX_TEST_WARNING_MODE === "routed"
      if (routed) routeProcessWarningsToLog()
      const emitter = new EventEmitter()
      for (let index = 0; index < 11; index++) emitter.on("keypress", () => {})
      await new Promise((resolve) => setImmediate(resolve))
    `
    const run = (mode: string) =>
      spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
        cwd: fileURLToPath(new URL("../../..", import.meta.url)),
        encoding: "utf8",
        env: { ...process.env, NODE_OPTIONS: "", AX_TEST_WARNING_MODE: mode },
      })
    const plain = run("plain")
    expect(plain.status).toBe(0)
    expect(plain.stderr).toContain("MaxListenersExceededWarning")
    const routed = run("routed")
    expect(routed.status).toBe(0)
    expect(routed.stderr).not.toContain("MaxListenersExceededWarning")
    expect(routed.stdout).not.toContain("MaxListenersExceededWarning")
  }, 60_000)
})
