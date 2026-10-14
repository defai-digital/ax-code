import { afterAll, afterEach, describe, expect, test } from "vitest"
import { codeIntelHost, configureCodeIntelHost } from "../src/host"
import { LspScheduler } from "../src/scheduler"
import "./harness"

const base = codeIntelHost()
let root = "/project-a"
configureCodeIntelHost({ ...base, projectRoot: () => root })
afterAll(() => configureCodeIntelHost(base))
afterEach(() => LspScheduler.Budget.resetForTest())

describe("LSP budget scope", () => {
  test("one project's server budget does not apply to another project", async () => {
    LspScheduler.Budget.setBudget("typescript", 1)
    const release = await LspScheduler.Budget.acquire("typescript")
    expect(LspScheduler.Budget.inUse("typescript")).toBe(1)

    // A second project configuring the same server must not raise the first
    // project's cap.
    root = "/project-b"
    LspScheduler.Budget.setBudget("typescript", 4)
    root = "/project-a"

    const second = LspScheduler.Budget.acquire("typescript")
    second.catch(() => undefined)
    const outcome = await Promise.race([
      second.then(() => "acquired" as const),
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 20)),
    ])
    expect(outcome).toBe("blocked")

    release()
    await second
  })
})
