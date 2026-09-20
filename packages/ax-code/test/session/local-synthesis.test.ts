import { expect, test, vi } from "vitest"
import { tool, jsonSchema } from "ai"
import {
  canPreserveLocalSynthesisTools,
  guardLocalSynthesisTools,
  LOCAL_SYNTHESIS_TOOL_REJECTION,
} from "../../src/session/prompt/local-synthesis"

const eligible = {
  providerID: "ax-engine",
  forceTextOnly: true,
  forceReason: "ax_engine_read_only" as const,
  hasEvidence: true,
  isLastStep: false,
  omitTools: false,
  structured: false,
  supportsTools: true,
}

test("only evidence-backed local convergence can preserve tool definitions", () => {
  expect(canPreserveLocalSynthesisTools(eligible)).toBe(true)
  for (const override of [
    { providerID: "other" },
    { forceTextOnly: false },
    { hasEvidence: false },
    { isLastStep: true },
    { omitTools: true },
    { structured: true },
    { supportsTools: false },
  ]) {
    expect(canPreserveLocalSynthesisTools({ ...eligible, ...override })).toBe(false)
  }
  for (const forceReason of [
    "goal_complete",
    "response_only",
    "truncated_recovery",
    "tool_only_breaker",
    "other",
  ] as const) {
    expect(canPreserveLocalSynthesisTools({ ...eligible, forceReason })).toBe(false)
  }
})

test("resolved registry, MCP, batch and custom callbacks cannot run during synthesis", async () => {
  const execute = vi.fn(async () => ({ output: "side effect" }))
  const needsApproval = vi.fn(() => true)
  const toModelOutput = vi.fn(() => ({ type: "text" as const, value: "side effect" }))
  const onInputStart = vi.fn()
  const onInputDelta = vi.fn()
  const onInputAvailable = vi.fn()
  const tools = Object.fromEntries(
    ["read", "bash", "write", "batch", "mcp_server_write", "custom"].map((name) => [
      name,
      tool({
        description: name,
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute,
        onInputStart,
        onInputDelta,
        onInputAvailable,
        needsApproval,
        toModelOutput,
      }),
    ]),
  )
  const guarded = guardLocalSynthesisTools(tools)
  expect(Object.keys(guarded)).toEqual(Object.keys(tools))
  for (const name of Object.keys(tools)) {
    expect(guarded[name].inputSchema).toBe(tools[name].inputSchema)
    expect(guarded[name].description).toBe(tools[name].description)
    expect(guarded[name].onInputStart).toBeUndefined()
    expect(guarded[name].onInputDelta).toBeUndefined()
    expect(guarded[name].onInputAvailable).toBeUndefined()
    expect(guarded[name].needsApproval).toBe(false)
    expect(guarded[name].toModelOutput).toBeUndefined()
    await expect(guarded[name].execute!({}, { toolCallId: name, messages: [] })).rejects.toThrow(
      LOCAL_SYNTHESIS_TOOL_REJECTION,
    )
  }
  expect(execute).not.toHaveBeenCalled()
  expect(onInputStart).not.toHaveBeenCalled()
  expect(onInputDelta).not.toHaveBeenCalled()
  expect(onInputAvailable).not.toHaveBeenCalled()
  expect(needsApproval).not.toHaveBeenCalled()
  expect(toModelOutput).not.toHaveBeenCalled()
  // No mutation of instance-owned tools; subsequent ordinary turns still work.
  await tools.read.execute!({}, { toolCallId: "ordinary", messages: [] })
  expect(execute).toHaveBeenCalledTimes(1)
})

test("provider-executed tools fail closed before a synthesis request", () => {
  expect(() =>
    guardLocalSynthesisTools({
      remote: {
        type: "provider",
        id: "vendor.remote",
        args: {},
        inputSchema: jsonSchema({ type: "object", properties: {} }),
      },
    }),
  ).toThrow("Provider-defined tools")
})
