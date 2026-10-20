import { expect, test, vi } from "vitest"
import { createTuiDebugClient } from "../src/tui-debug.js"

const target = {
  instanceId: "10000000-0000-4000-8000-000000000001",
  generation: "10000000-0000-4000-8000-000000000002",
}
test("TUI client validates inputs and responses, preserves rejections and never retries", async () => {
  const callTool = vi.fn(
    async (_: unknown): Promise<unknown> => ({ structuredContent: { status: "rejected", code: "timeout_unknown" } }),
  )
  const client = createTuiDebugClient({ callTool })
  expect(
    await client.input({
      ...target,
      expectedRevision: 0,
      requestId: "10000000-0000-4000-8000-000000000003",
      action: { kind: "key", key: "enter" },
    }),
  ).toEqual({ status: "rejected", code: "timeout_unknown" })
  expect(callTool).toHaveBeenCalledTimes(1)
  await expect(client.wait({ ...target, text: "ready", timeoutMs: 3001 })).rejects.toThrow()
  expect(callTool).toHaveBeenCalledTimes(1)
  callTool.mockResolvedValue({ structuredContent: { status: "snapshot", screen: { text: "invalid" } } })
  await expect(client.snapshot(target)).rejects.toThrow()
})
