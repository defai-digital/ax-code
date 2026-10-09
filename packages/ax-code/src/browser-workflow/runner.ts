import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { BrowserScenario } from "./scenario"
import { WebMcpProfile } from "../mcp/webmcp-profile"
import { isRecord } from "../util/record"
import { parseJsonPayload } from "../util/json-value"

export namespace BrowserRunner {
  const issued = new WeakMap<object, string>()
  export function authentic(receipt: Receipt): boolean {
    return issued.get(receipt) === BrowserScenario.digest(receipt)
  }
  export type Status = "pass" | "fail" | "unknown"
  export type StepResult = { index: number; status: Status; reason: string; snapshotHash?: string }
  export type Receipt = {
    id: string
    scenarioHash: string
    baseline: BrowserScenario.Identity
    identity: BrowserScenario.Identity
    origin: string
    runner: string
    bridge: string
    startedAt: string
    status: Status
    steps: StepResult[]
    cleanup: boolean
    diagnostics: {
      console: string[]
      network: string[]
      consoleBaseline: string[]
      networkBaseline: string[]
      complete: boolean
    }
  }
  export type Port = {
    call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
    start(signal: AbortSignal): Promise<string>
    stop(): Promise<void>
    identity(): Promise<BrowserScenario.Identity>
  }
  function lines(value: unknown): string[] {
    if (!isRecord(value) || !Array.isArray(value.content)) return []
    return value.content
      .flatMap((item) =>
        isRecord(item) && item.type === "text" && typeof item.text === "string" ? item.text.split("\n") : [],
      )
      .filter((line) => !WebMcpProfile.credentialLike(line))
      .slice(-50)
      .map((line) => line.slice(0, 512))
  }
  function delta(before: string[], after: string[]): string[] {
    const counts = new Map<string, number>()
    for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1)
    return after.filter((line) => {
      const count = counts.get(line) ?? 0
      if (!count) return true
      counts.set(line, count - 1)
      return false
    })
  }
  function losslessSnapshot(result: unknown): boolean {
    if (!isRecord(result) || !isRecord(result.structuredContent) || !isRecord(result.structuredContent.snapshot))
      return false
    const nodes: unknown[] = [result.structuredContent.snapshot]
    let count = 0
    while (nodes.length) {
      const node = nodes.pop()
      if (!isRecord(node) || ++count > 5000) return false
      if ([node.role, node.name, node.value].some((value) => typeof value === "string" && value.length > 512))
        return false
      if (Array.isArray(node.children)) nodes.push(...node.children)
    }
    return true
  }
  function output(value: unknown): unknown {
    if (!isRecord(value) || !isRecord(value.structuredContent)) return undefined
    const completion = parseJsonPayload(
      typeof value.structuredContent.message === "string" ? value.structuredContent.message : undefined,
    )
    if (!isRecord(completion) || completion.status !== "Completed") return undefined
    return typeof completion.output === "string"
      ? (parseJsonPayload(completion.output) ?? completion.output)
      : completion.output
  }
  function at(value: unknown, path: string[]): unknown {
    for (const key of path) {
      if (!isRecord(value) || !Object.hasOwn(value, key)) return undefined
      value = value[key]
    }
    return value
  }
  export async function run(frozen: BrowserScenario.Frozen, port: Port, abort: AbortSignal): Promise<Receipt> {
    const signal = AbortSignal.any([abort, AbortSignal.timeout(120_000)])
    const before = await port.identity()
    const receipt: Receipt = {
      id: randomUUID(),
      scenarioHash: frozen.hash,
      baseline: frozen.baseline,
      identity: before,
      origin: "",
      runner: frozen.runner,
      bridge: frozen.bridge,
      startedAt: new Date().toISOString(),
      status: "unknown",
      steps: [],
      cleanup: false,
      diagnostics: { console: [], network: [], consoleBaseline: [], networkBaseline: [], complete: false },
    }
    let pageId: number | undefined
    let navigationAttempted = false
    let previousPages: Map<number, string> | undefined
    let consoleBefore: string[] = []
    let networkBefore: string[] = []
    const call = async (name: string, args: Record<string, unknown>) => {
      signal.throwIfAborted()
      return port.call(name, args, signal)
    }
    const ownedPages = (result: unknown): Map<number, string> => {
      const pages = WebMcpProfile.parseStructuredPages(result)
      if (
        !pages ||
        !isRecord(result) ||
        !isRecord(result.structuredContent) ||
        !Array.isArray(result.structuredContent.pages)
      )
        throw new Error("Owned page inventory unavailable")
      const ids = new Set(
        result.structuredContent.pages
          .filter((page) => isRecord(page) && page.isolatedContext === `ax-workflow-${receipt.id}`)
          .map((page) => (page as { id: number }).id),
      )
      return new Map([...pages].filter(([id]) => ids.has(id)))
    }
    const snapshot = async () => {
      const result = await call("take_snapshot", { pageId })
      const nodes = WebMcpProfile.parseStructuredSnapshot(result)
      if (!nodes?.size || !losslessSnapshot(result)) throw new Error("Lossless structured snapshot unavailable")
      // Runtime dispatch validates origins; this also binds the scenario's exact page origin.
      const pages = ownedPages(await call("list_pages", {}))
      const url = pages.get(pageId!)
      if (!url || new URL(url).origin !== receipt.origin) throw new Error("Scenario page left its origin")
      signal.throwIfAborted()
      return nodes
    }
    try {
      receipt.origin = await port.start(signal)
      const origin = new URL(receipt.origin)
      if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.origin !== receipt.origin)
        throw new Error("Scenario requires an exact loopback test origin")
      const url = new URL(frozen.manifest.path, origin).href
      const previous = WebMcpProfile.parseStructuredPages(await call("list_pages", {}))
      if (!previous) throw new Error("Page inventory unavailable")
      previousPages = previous
      navigationAttempted = true
      const openCall = { url }
      WebMcpProfile.bindWorkflowContext(openCall, receipt.id)
      await call("new_page", openCall)
      const pages = ownedPages(await call("list_pages", {}))
      const created = [...pages].filter(
        ([id, location]) => !previous.has(id) && new URL(location).origin === receipt.origin,
      )
      if (created.length !== 1) throw new Error("Cannot identify the newly created page")
      pageId = created[0]![0]
      await snapshot()
      consoleBefore = lines(await call("list_console_messages", { pageId }))
      networkBefore = lines(await call("list_network_requests", { pageId }))
      receipt.diagnostics.consoleBaseline = consoleBefore
      receipt.diagnostics.networkBaseline = networkBefore
      for (const [index, step] of frozen.manifest.steps.entries()) {
        const nodes = await snapshot()
        let snapshotHash = BrowserScenario.digest([...nodes.values()].map(({ uid: _uid, ...node }) => node))
        let status: Status = "pass"
        let reason = "Action completed; subsequent assertions determine behavior"
        if (step.action === "assert") {
          status = BrowserScenario.assert(nodes.values(), step.assertion)
          const deadline = Date.now() + step.timeoutMs
          // Poll only structured reads. Actions and permission failures are never retried.
          while (status !== "pass" && Date.now() < deadline) {
            await delay(Math.max(0, Math.min(100, deadline - Date.now())), undefined, { signal })
            const latest = await snapshot()
            snapshotHash = BrowserScenario.digest([...latest.values()].map(({ uid: _uid, ...node }) => node))
            status = BrowserScenario.assert(latest.values(), step.assertion)
          }
          reason =
            status === "pass"
              ? "Structured assertion matched"
              : status === "fail"
                ? "Structured assertion differed"
                : "Assertion state unavailable or ambiguous"
        } else if (step.action === "contract") {
          const listing = await call("list_webmcp_tools", { pageId })
          const descriptors = WebMcpProfile.parseToolListing(listing)
          if (!descriptors) throw new Error("Structured page-tool descriptors unavailable")
          const descriptor = descriptors.find((entry) => entry.name === step.name)
          if (!descriptor || WebMcpProfile.descriptorHash(descriptor) !== step.descriptorHash) {
            status = "fail"
            reason = "Page-tool descriptor changed or is missing"
          } else {
            try {
              const result = await call("execute_webmcp_tool", {
                pageId,
                toolName: step.name,
                input: JSON.stringify(step.input),
              })
              status =
                !step.expectError &&
                at(output(result), step.resultPath) !== undefined &&
                BrowserScenario.canonical(at(output(result), step.resultPath)) ===
                  BrowserScenario.canonical(step.equals)
                  ? "pass"
                  : "fail"
              reason = step.expectError
                ? "Expected page-tool error was not reported"
                : status === "pass"
                  ? "Page-tool result matched"
                  : "Page-tool result differed"
            } catch (error) {
              if (!(error instanceof WebMcpProfile.PageInvocationError)) throw error
              status = step.expectError ? "pass" : "fail"
              reason = step.expectError
                ? "Expected page-tool execution error confirmed"
                : "Page tool reported an execution error"
            }
          }
        } else {
          const found = BrowserScenario.matches(nodes.values(), step.locator)
          if (found.length !== 1) {
            status = "unknown"
            reason = "Action locator is missing or ambiguous"
          } else
            await call(step.action, {
              pageId,
              uid: found[0]!.uid,
              ...(step.action === "fill" ? { value: step.value } : {}),
            })
        }
        if (status === "pass" && step.action !== "assert") {
          const after = await snapshot()
          snapshotHash = BrowserScenario.digest([...after.values()].map(({ uid: _uid, ...node }) => node))
        }
        receipt.steps.push({ index, status, reason, snapshotHash })
        if (status !== "pass") {
          receipt.status = status
          break
        }
      }
      if (
        receipt.steps.length === frozen.manifest.steps.length &&
        receipt.steps.every((step) => step.status === "pass")
      )
        receipt.status = "pass"
    } catch {
      receipt.status = "unknown"
      receipt.steps.push({
        index: receipt.steps.length,
        status: "unknown",
        reason: signal.aborted
          ? "Run canceled or deadline exceeded"
          : "Browser, lifecycle or permission operation did not complete",
      })
    } finally {
      if (pageId === undefined && navigationAttempted && previousPages) {
        try {
          const current = ownedPages(await port.call("list_pages", {}, AbortSignal.timeout(5000)))
          const added = [...(current ?? [])].filter(([id]) => !previousPages!.has(id))
          if (added.length === 1) pageId = added[0]![0]
        } catch {
          /* Missing inventory remains unknown; never guess a page ID. */
        }
      }
      if (pageId !== undefined && !signal.aborted) {
        try {
          receipt.diagnostics.console = delta(consoleBefore, lines(await call("list_console_messages", { pageId })))
          receipt.diagnostics.network = delta(networkBefore, lines(await call("list_network_requests", { pageId })))
          receipt.diagnostics.complete = true
        } catch {
          receipt.diagnostics.complete = false
        }
      }
      let closed = !navigationAttempted
      if (navigationAttempted) {
        try {
          const cleanupSignal = AbortSignal.timeout(10000)
          const remaining = ownedPages(await port.call("list_pages", {}, cleanupSignal))
          if (remaining.size > 8) throw new Error("Too many workflow pages to close safely")
          for (const id of remaining.keys()) await port.call("close_page", { pageId: id }, cleanupSignal)
          closed = ownedPages(await port.call("list_pages", {}, cleanupSignal)).size === 0
        } catch {
          closed = false
        }
      }
      try {
        await port.stop()
        receipt.cleanup = closed
      } catch {
        receipt.cleanup = false
      }
    }
    try {
      const after = await port.identity()
      if (before.tree !== after.tree || before.revision !== after.revision) receipt.status = "unknown"
    } catch {
      receipt.status = "unknown"
    }
    if (!receipt.cleanup || !receipt.diagnostics.complete) receipt.status = "unknown"
    issued.set(receipt, BrowserScenario.digest(receipt))
    return receipt
  }
}
