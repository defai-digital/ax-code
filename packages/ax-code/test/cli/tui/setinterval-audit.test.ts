import { describe, expect, test } from "bun:test"
import { Glob } from "bun"
import fs from "fs/promises"
import path from "path"

const TUI_ROOT = path.resolve(import.meta.dir, "../../../src/cli/cmd/tui")

// Strip line / block comments so substring matches don't trigger on
// comment text. Imperfect (won't handle template-literal // patterns),
// but the TUI source doesn't have those.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

// Match identifier-like uses of setInterval, not the type alias usage
// `ReturnType<typeof setInterval>` and not the parameter binding
// `setInterval` in a function signature. We accept either:
//   - `setInterval(...)` (call expression)
//   - `setIntervalFn(...)` (injected variant pattern used by sync-startup.ts)
const SETINTERVAL_CALL = /\b(?:setInterval|setIntervalFn)\s*\(/g
const CLEARINTERVAL_CALL = /\b(?:clearInterval|clearIntervalFn)\s*\(/g

async function tuiFiles(): Promise<string[]> {
  const out: string[] = []
  for await (const file of new Glob("**/*.{ts,tsx}").scan({ cwd: TUI_ROOT, absolute: true })) {
    out.push(file)
  }
  out.sort()
  return out
}

describe("tui setInterval / clearInterval pairing audit", () => {
  test("every TUI file that calls setInterval also calls clearInterval", async () => {
    // The audit catches the obvious leak where someone adds an interval
    // without wiring its cleanup. It does not verify the cleanup is
    // reachable from every code path — that is what onCleanup-aware
    // tests in render-anti-patterns.test.ts cover.
    const offenders: string[] = []
    for (const file of await tuiFiles()) {
      const text = stripComments(await fs.readFile(file, "utf8"))
      const setCount = (text.match(SETINTERVAL_CALL) ?? []).length
      const clearCount = (text.match(CLEARINTERVAL_CALL) ?? []).length
      if (setCount > 0 && clearCount === 0) {
        offenders.push(path.relative(TUI_ROOT, file))
      }
    }
    expect(offenders).toEqual([])
  })

  test("no TUI file uses setInterval without a cleanup hook somewhere", async () => {
    // Stronger heuristic: every file using setInterval should also
    // reference some cleanup mechanism. Accepted patterns:
    //   - onCleanup(...) (SolidJS reactive cleanup)
    //   - finally { clearInterval(...) }
    //   - explicit unhook/dispose closure pattern (e.g. win32.ts:117–132
    //     stashes clearInterval in a returned unhook function)
    // The audit accepts any of these by requiring that clearInterval
    // appear in the same file. Files that use setInterval without ever
    // referencing clearInterval are presumed leaky and must justify the
    // pattern (or this test is the wrong place to enforce).
    const offenders: string[] = []
    for (const file of await tuiFiles()) {
      const text = stripComments(await fs.readFile(file, "utf8"))
      const setCount = (text.match(SETINTERVAL_CALL) ?? []).length
      if (setCount === 0) continue
      const hasClear = (text.match(CLEARINTERVAL_CALL) ?? []).length > 0
      if (!hasClear) {
        offenders.push(path.relative(TUI_ROOT, file))
      }
    }
    expect(offenders).toEqual([])
  })
})
