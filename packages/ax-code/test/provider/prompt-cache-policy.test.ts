import { describe, expect, test } from "vitest"
import { PromptCachePolicy } from "@/provider/prompt-cache-policy"

describe("PromptCachePolicy.policyMode", () => {
  test("returns alibaba-explicit for alibaba-coding-plan", () => {
    expect(PromptCachePolicy.policyMode("alibaba-coding-plan")).toBe("alibaba-explicit")
  })

  test("returns alibaba-explicit for alibaba-token-plan-cn", () => {
    expect(PromptCachePolicy.policyMode("alibaba-token-plan-cn")).toBe("alibaba-explicit")
  })

  test("returns alibaba-explicit for alibaba-pai", () => {
    expect(PromptCachePolicy.policyMode("alibaba-pai")).toBe("alibaba-explicit")
    expect(PromptCachePolicy.honorsExplicitCache("alibaba-pai")).toBe(true)
  })

  test("returns off for unverified providers", () => {
    expect(PromptCachePolicy.policyMode("togetherai")).toBe("off")
    expect(PromptCachePolicy.honorsExplicitCache("togetherai")).toBe(false)
  })

  test("returns off for anthropic", () => {
    expect(PromptCachePolicy.policyMode("anthropic")).toBe("off")
  })

  test("returns off for unknown provider", () => {
    expect(PromptCachePolicy.policyMode("some-gateway")).toBe("off")
  })
})

describe("PromptCachePolicy.classifyBlock", () => {
  test("classifies system as stable", () => {
    expect(PromptCachePolicy.classifyBlock("system")).toBe("stable")
  })

  test("classifies tools as stable", () => {
    expect(PromptCachePolicy.classifyBlock("tools")).toBe("stable")
  })

  test("classifies agents-md as stable", () => {
    expect(PromptCachePolicy.classifyBlock("agents-md")).toBe("stable")
  })

  test("classifies repo-memory as stable", () => {
    expect(PromptCachePolicy.classifyBlock("repo-memory")).toBe("stable")
  })

  test("classifies context-pack as stable", () => {
    expect(PromptCachePolicy.classifyBlock("context-pack")).toBe("stable")
  })

  test("classifies adr as stable", () => {
    expect(PromptCachePolicy.classifyBlock("adr")).toBe("stable")
  })

  test("classifies user-request as dynamic", () => {
    expect(PromptCachePolicy.classifyBlock("user-request")).toBe("dynamic")
  })

  test("classifies tool-result as dynamic", () => {
    expect(PromptCachePolicy.classifyBlock("tool-result")).toBe("dynamic")
  })

  test("classifies failed-command as dynamic", () => {
    expect(PromptCachePolicy.classifyBlock("failed-command")).toBe("dynamic")
  })

  test("classifies retry-prompt as dynamic", () => {
    expect(PromptCachePolicy.classifyBlock("retry-prompt")).toBe("dynamic")
  })

  test("classifies unknown label as dynamic (safe default)", () => {
    expect(PromptCachePolicy.classifyBlock("mystery-label")).toBe("dynamic")
  })

  test("classifies undefined as dynamic", () => {
    expect(PromptCachePolicy.classifyBlock(undefined)).toBe("dynamic")
  })
})

describe("PromptCachePolicy.render - alibaba-explicit mode", () => {
  const provider = "alibaba-coding-plan"

  test("stable blocks get cache_control ephemeral", () => {
    const blocks: PromptCachePolicy.CacheBlock[] = [{ kind: "stable", content: "sys prompt", label: "system" }]
    const result = PromptCachePolicy.render(blocks, provider)
    expect(result.mode).toBe("alibaba-explicit")
    expect(result.blocks[0].cacheControl).toEqual({ type: "ephemeral" })
  })

  test("dynamic blocks do not get cache_control", () => {
    const blocks: PromptCachePolicy.CacheBlock[] = [{ kind: "dynamic", content: "user msg", label: "user-request" }]
    const result = PromptCachePolicy.render(blocks, provider)
    expect(result.blocks[0].cacheControl).toBeUndefined()
  })

  test("mixed blocks: stable annotated, dynamic not", () => {
    const blocks: PromptCachePolicy.CacheBlock[] = [
      { kind: "stable", content: "tools json", label: "tools" },
      { kind: "dynamic", content: "tool result", label: "tool-result" },
      { kind: "stable", content: "agents.md content", label: "agents-md" },
    ]
    const result = PromptCachePolicy.render(blocks, provider)
    expect(result.blocks[0].cacheControl).toEqual({ type: "ephemeral" })
    expect(result.blocks[1].cacheControl).toBeUndefined()
    expect(result.blocks[2].cacheControl).toEqual({ type: "ephemeral" })
  })

  test("debug lines are produced", () => {
    const blocks: PromptCachePolicy.CacheBlock[] = [
      { kind: "stable", content: "sys", label: "system" },
      { kind: "dynamic", content: "req", label: "user-request" },
    ]
    const result = PromptCachePolicy.render(blocks, provider)
    expect(result.debugLines).toHaveLength(2)
    expect(result.debugLines[0]).toContain("stable")
    expect(result.debugLines[1]).toContain("skip")
  })
})

describe("PromptCachePolicy.render - off mode", () => {
  test("no blocks receive cache_control in off mode", () => {
    const blocks: PromptCachePolicy.CacheBlock[] = [
      { kind: "stable", content: "sys", label: "system" },
      { kind: "stable", content: "tools", label: "tools" },
    ]
    const result = PromptCachePolicy.render(blocks, "togetherai")
    expect(result.mode).toBe("off")
    expect(result.blocks.every((b) => b.cacheControl === undefined)).toBe(true)
  })
})

describe("PromptCachePolicy.buildBlocks", () => {
  test("classifies and builds blocks from label/content pairs", () => {
    const blocks = PromptCachePolicy.buildBlocks([
      { label: "system", content: "sys prompt" },
      { label: "user-request", content: "fix bug" },
      { label: "repo-memory", content: "memory json" },
    ])
    expect(blocks[0].kind).toBe("stable")
    expect(blocks[1].kind).toBe("dynamic")
    expect(blocks[2].kind).toBe("stable")
    expect(blocks[0].label).toBe("system")
  })
})

describe("PromptCachePolicy.resolveMode", () => {
  test("keeps first-party automatic default when no override is set", () => {
    expect(PromptCachePolicy.resolveMode("alibaba-coding-plan")).toBe("alibaba-explicit")
    expect(PromptCachePolicy.resolveMode("alibaba-pai")).toBe("alibaba-explicit")
    expect(PromptCachePolicy.resolveMode("xiaomi")).toBe("off")
  })

  test("fails closed for empty or non-string configured overrides", () => {
    expect(PromptCachePolicy.resolveMode("alibaba-coding-plan", "")).toBe("off")
    expect(PromptCachePolicy.resolveMode("alibaba-coding-plan", null)).toBe("off")
    expect(PromptCachePolicy.resolveMode("alibaba-coding-plan", true)).toBe("off")
    expect(PromptCachePolicy.resolveMode("xiaomi", "")).toBe("off")
  })

  test("alibaba-explicit override opts a non-first-party provider in", () => {
    expect(PromptCachePolicy.resolveMode("xiaomi", "alibaba-explicit")).toBe("alibaba-explicit")
    expect(PromptCachePolicy.resolveMode("some-gateway", "alibaba-explicit")).toBe("alibaba-explicit")
  })

  test("off override disables a first-party provider", () => {
    expect(PromptCachePolicy.resolveMode("alibaba-coding-plan", "off")).toBe("off")
  })

  test("unknown configured mode fails safe to off even for first-party providers", () => {
    expect(PromptCachePolicy.resolveMode("alibaba-coding-plan", "dashscope-v9")).toBe("off")
    expect(PromptCachePolicy.resolveMode("alibaba-pai", "banana")).toBe("off")
    expect(PromptCachePolicy.resolveMode("xiaomi", "banana")).toBe("off")
  })
})

describe("PromptCachePolicy.render - stable-block marker cap", () => {
  const provider = "alibaba-coding-plan"

  function stableBlocks(count: number): PromptCachePolicy.CacheBlock[] {
    return Array.from({ length: count }, (_, i) => ({
      kind: "stable" as const,
      content: `stable block ${i}`,
      label: i === 0 ? "system" : "stable-rules",
    }))
  }

  test("cap is 4 markers", () => {
    expect(PromptCachePolicy.MAX_STABLE_BLOCK_MARKERS).toBe(4)
  })

  test("annotates at most the first 4 stable blocks", () => {
    const result = PromptCachePolicy.render(stableBlocks(6), provider)
    expect(result.mode).toBe("alibaba-explicit")
    expect(result.blocks.filter((b) => b.cacheControl !== undefined)).toHaveLength(4)
    expect(result.blocks[0].cacheControl).toEqual({ type: "ephemeral" })
    expect(result.blocks[3].cacheControl).toEqual({ type: "ephemeral" })
    expect(result.blocks[4].cacheControl).toBeUndefined()
    expect(result.blocks[5].cacheControl).toBeUndefined()
  })

  test("capped stable blocks are still rendered with their content", () => {
    const result = PromptCachePolicy.render(stableBlocks(5), provider)
    expect(result.blocks).toHaveLength(5)
    expect(result.blocks[4]).toEqual({ content: "stable block 4" })
  })

  test("annotates all stable blocks when at or under the cap", () => {
    for (const count of [1, 4]) {
      const result = PromptCachePolicy.render(stableBlocks(count), provider)
      expect(result.blocks.every((b) => b.cacheControl !== undefined)).toBe(true)
    }
  })

  test("dynamic blocks are never annotated even when interleaved under the cap", () => {
    const blocks: PromptCachePolicy.CacheBlock[] = [
      { kind: "stable", content: "sys", label: "system" },
      { kind: "dynamic", content: "req", label: "user-request" },
      { kind: "stable", content: "tools", label: "tools" },
      { kind: "dynamic", content: "retry", label: "retry-prompt" },
    ]
    const result = PromptCachePolicy.render(blocks, provider)
    expect(result.blocks[0].cacheControl).toEqual({ type: "ephemeral" })
    expect(result.blocks[1].cacheControl).toBeUndefined()
    expect(result.blocks[2].cacheControl).toEqual({ type: "ephemeral" })
    expect(result.blocks[3].cacheControl).toBeUndefined()
  })

  test("dynamic blocks do not consume the stable-block marker budget", () => {
    const blocks: PromptCachePolicy.CacheBlock[] = [
      { kind: "stable", content: "a", label: "system" },
      { kind: "dynamic", content: "d1", label: "user-request" },
      { kind: "stable", content: "b", label: "tools" },
      { kind: "dynamic", content: "d2", label: "tool-result" },
      { kind: "stable", content: "c", label: "agents-md" },
      { kind: "stable", content: "d", label: "repo-memory" },
    ]
    const result = PromptCachePolicy.render(blocks, provider)
    expect(result.blocks.filter((b) => b.cacheControl !== undefined)).toHaveLength(4)
    expect(result.blocks[5].cacheControl).toEqual({ type: "ephemeral" })
  })
})

describe("PromptCachePolicy.render - mode override", () => {
  test("alibaba-explicit override annotates stable blocks on a non-first-party provider", () => {
    const blocks: PromptCachePolicy.CacheBlock[] = [{ kind: "stable", content: "sys", label: "system" }]
    const result = PromptCachePolicy.render(blocks, "xiaomi", "alibaba-explicit")
    expect(result.mode).toBe("alibaba-explicit")
    expect(result.blocks[0].cacheControl).toEqual({ type: "ephemeral" })
  })

  test("unknown override disables annotations on a first-party provider", () => {
    const blocks: PromptCachePolicy.CacheBlock[] = [{ kind: "stable", content: "sys", label: "system" }]
    const result = PromptCachePolicy.render(blocks, "alibaba-coding-plan", "dashscope-v9")
    expect(result.mode).toBe("off")
    expect(result.blocks.every((b) => b.cacheControl === undefined)).toBe(true)
  })

  test("off override disables annotations on a first-party provider", () => {
    const blocks: PromptCachePolicy.CacheBlock[] = [{ kind: "stable", content: "sys", label: "system" }]
    const result = PromptCachePolicy.render(blocks, "alibaba-pai", "off")
    expect(result.mode).toBe("off")
    expect(result.blocks.every((b) => b.cacheControl === undefined)).toBe(true)
  })

  test("override participates in the marker cap", () => {
    const blocks: PromptCachePolicy.CacheBlock[] = Array.from({ length: 6 }, (_, i) => ({
      kind: "stable" as const,
      content: `block ${i}`,
      label: "stable-rules",
    }))
    const result = PromptCachePolicy.render(blocks, "xiaomi", "alibaba-explicit")
    expect(result.blocks.filter((b) => b.cacheControl !== undefined)).toHaveLength(
      PromptCachePolicy.MAX_STABLE_BLOCK_MARKERS,
    )
  })
})

describe("PromptCachePolicy.debugRender", () => {
  test("starts with mode= line", () => {
    const blocks = PromptCachePolicy.buildBlocks([{ label: "system", content: "x" }])
    const out = PromptCachePolicy.debugRender(blocks, "alibaba-coding-plan")
    expect(out.startsWith("mode=alibaba-explicit")).toBe(true)
  })

  test("does not include secret values in output (content not echoed)", () => {
    const secret = "sk-1234-super-secret"
    const blocks = PromptCachePolicy.buildBlocks([{ label: "system", content: secret }])
    const out = PromptCachePolicy.debugRender(blocks, "alibaba-coding-plan")
    expect(out).not.toContain(secret)
  })
})
