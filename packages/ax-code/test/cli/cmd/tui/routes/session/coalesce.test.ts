import { describe, expect, test } from "bun:test"
import { coalesceParts } from "@/cli/cmd/tui/routes/session/coalesce"
import type { Part, ToolPart } from "@ax-code/sdk/v2"

// Lightweight ToolPart factory — we only need fields the coalescer reads
// (type, tool, callID, state.status). Everything else is `as any` so we
// don't have to construct the full v2 shape.
function tool(opts: {
  tool: string
  callID: string
  status?: "completed" | "pending" | "running" | "error"
}): ToolPart {
  return {
    type: "tool",
    tool: opts.tool,
    callID: opts.callID,
    state: { status: opts.status ?? "completed" } as any,
  } as ToolPart
}

function text(id: string): Part {
  return { type: "text", text: id, id } as any
}

describe("coalesceParts", () => {
  test("empty input returns empty", () => {
    expect(coalesceParts([])).toEqual([])
  })

  test("5 consecutive reads collapse into one coalesced entry", () => {
    const parts = [
      tool({ tool: "read", callID: "a" }),
      tool({ tool: "read", callID: "b" }),
      tool({ tool: "read", callID: "c" }),
      tool({ tool: "read", callID: "d" }),
      tool({ tool: "read", callID: "e" }),
    ]
    const result = coalesceParts(parts)
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe("coalesced")
    if (result[0].kind === "coalesced") {
      expect(result[0].tool).toBe("read")
      expect(result[0].parts).toHaveLength(5)
      expect(result[0].key).toBe("a")
    }
  })

  test("2 consecutive reads stay separate (under min threshold)", () => {
    const parts = [tool({ tool: "read", callID: "a" }), tool({ tool: "read", callID: "b" })]
    const result = coalesceParts(parts)
    expect(result).toHaveLength(2)
    expect(result.every((r) => r.kind === "single")).toBe(true)
  })

  test("mixed run splits into per-tool groups", () => {
    // read x3, grep x3 — both eligible, both coalesce, in order
    const parts = [
      tool({ tool: "read", callID: "r1" }),
      tool({ tool: "read", callID: "r2" }),
      tool({ tool: "read", callID: "r3" }),
      tool({ tool: "grep", callID: "g1" }),
      tool({ tool: "grep", callID: "g2" }),
      tool({ tool: "grep", callID: "g3" }),
    ]
    const result = coalesceParts(parts)
    expect(result).toHaveLength(2)
    expect(result[0].kind).toBe("coalesced")
    expect(result[1].kind).toBe("coalesced")
    if (result[0].kind === "coalesced" && result[1].kind === "coalesced") {
      expect(result[0].tool).toBe("read")
      expect(result[1].tool).toBe("grep")
    }
  })

  test("ineligible tool in middle breaks the run", () => {
    // 2 reads, a bash (ineligible), 2 reads — neither side meets threshold
    const parts = [
      tool({ tool: "read", callID: "a" }),
      tool({ tool: "read", callID: "b" }),
      tool({ tool: "bash", callID: "sh" }),
      tool({ tool: "read", callID: "c" }),
      tool({ tool: "read", callID: "d" }),
    ]
    const result = coalesceParts(parts)
    expect(result).toHaveLength(5)
    expect(result.every((r) => r.kind === "single")).toBe(true)
  })

  test("errored read inside run bursts the group", () => {
    // 5 reads but the 3rd failed — must render individually so the
    // failure isn't hidden inside a "Read · 5 files" summary
    const parts = [
      tool({ tool: "read", callID: "a" }),
      tool({ tool: "read", callID: "b" }),
      tool({ tool: "read", callID: "c", status: "error" }),
      tool({ tool: "read", callID: "d" }),
      tool({ tool: "read", callID: "e" }),
    ]
    const result = coalesceParts(parts)
    // The errored read splits the run into [a,b] (2, no coalesce),
    // [c] (alone), [d,e] (2, no coalesce). So all 5 stay single.
    expect(result).toHaveLength(5)
    expect(result.every((r) => r.kind === "single")).toBe(true)
  })

  test("non-tool parts pass through and break runs", () => {
    const parts: Part[] = [
      tool({ tool: "read", callID: "a" }),
      tool({ tool: "read", callID: "b" }),
      text("intermission"),
      tool({ tool: "read", callID: "c" }),
      tool({ tool: "read", callID: "d" }),
      tool({ tool: "read", callID: "e" }),
    ]
    const result = coalesceParts(parts)
    // 2 reads → singles; text → single; 3 reads → coalesced
    expect(result).toHaveLength(4)
    expect(result[0].kind).toBe("single")
    expect(result[1].kind).toBe("single")
    expect(result[2].kind).toBe("single")
    expect(result[3].kind).toBe("coalesced")
    if (result[3].kind === "coalesced") {
      expect(result[3].parts).toHaveLength(3)
    }
  })

  test("bash is never coalesced even at length 5", () => {
    const parts = [
      tool({ tool: "bash", callID: "a" }),
      tool({ tool: "bash", callID: "b" }),
      tool({ tool: "bash", callID: "c" }),
      tool({ tool: "bash", callID: "d" }),
      tool({ tool: "bash", callID: "e" }),
    ]
    const result = coalesceParts(parts)
    expect(result).toHaveLength(5)
    expect(result.every((r) => r.kind === "single")).toBe(true)
  })
})
