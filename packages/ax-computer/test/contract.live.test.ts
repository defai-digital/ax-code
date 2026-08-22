// Live protocol-contract check: every OCU-dialect backend (the AX-owned
// native driver and the upstream reference) must advertise the full tool
// inventory the provider layer calls. Catches upstream drift — a renamed or
// removed tool fails here at preflight time instead of surfacing as a
// mid-task refusal.
//
// Run: AX_COMPUTER_LIVE=1 pnpm --dir packages/ax-computer exec vitest run test/contract.live.test.ts
import { describe, expect, test } from "vitest"
import { StdioMcpClient } from "../src/mcp/stdio-client"
import { defaultAxnativeCommand } from "../src/providers/axnative"
import { checkDialectContract, probeDialectContract } from "../src/protocol-contract"

const live = process.env.AX_COMPUTER_LIVE === "1"

async function withClient<T>(command: string, fn: (client: StdioMcpClient) => Promise<T>): Promise<T> {
  const client = await StdioMcpClient.start({ command, args: ["mcp"] })
  try {
    return await fn(client)
  } finally {
    await client.close().catch(() => {})
  }
}

describe.skipIf(!live)("protocol contract: OCU dialect backends", () => {
  test("axnative advertises every required tool", { timeout: 60_000 }, async () => {
    const command = process.env.AX_COMPUTER_AXNATIVE_COMMAND ?? defaultAxnativeCommand()
    const report = await withClient(command, probeDialectContract)
    expect(report.missing, `missing tools: ${report.missing.join(", ")}`).toEqual([])
    expect(report.ok).toBe(true)
  })

  test("upstream ocu reference advertises every required tool", { timeout: 60_000 }, async () => {
    const command = process.env.AX_COMPUTER_OCU_COMMAND ?? "open-computer-use"
    const report = await withClient(command, probeDialectContract)
    expect(report.missing, `missing tools: ${report.missing.join(", ")}`).toEqual([])
    expect(report.ok).toBe(true)
  })

  test("tool inventory diff is reported informationally (planned AX-only divergence allowed)", { timeout: 60_000 }, async () => {
    const axnative = await withClient(
      process.env.AX_COMPUTER_AXNATIVE_COMMAND ?? defaultAxnativeCommand(),
      async (client) => (await client.listTools()).map((tool) => tool.name).sort(),
    )
    const upstream = await withClient(process.env.AX_COMPUTER_OCU_COMMAND ?? "open-computer-use", async (client) =>
      (await client.listTools()).map((tool) => tool.name).sort(),
    )
    // AX-only tools are expected over time (subclass divergence by design);
    // what must never drift away is the required dialect set — asserted above.
    // eslint-disable-next-line no-console
    console.log("dialect inventory diff:", {
      onlyAxnative: axnative.filter((t) => !upstream.includes(t)),
      onlyUpstream: upstream.filter((t) => !axnative.includes(t)),
    })
  })
})

describe("checkDialectContract (pure)", () => {
  test("ok when all required tools are advertised", () => {
    const report = checkDialectContract([
      "list_apps",
      "get_app_state",
      "click",
      "type_text",
      "press_key",
      "scroll",
      "drag",
      "set_value",
      "some_future_tool",
    ])
    expect(report.ok).toBe(true)
    expect(report.missing).toEqual([])
    expect(report.extra).toEqual(["some_future_tool"])
  })

  test("reports missing tools", () => {
    const report = checkDialectContract(["list_apps", "click"])
    expect(report.ok).toBe(false)
    expect(report.missing).toEqual(["get_app_state", "type_text", "press_key", "scroll", "drag", "set_value"])
  })
})
