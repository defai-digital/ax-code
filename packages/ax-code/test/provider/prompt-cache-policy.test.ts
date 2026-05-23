import { describe, expect, test } from "bun:test"
import { PromptCachePolicy } from "@/provider/prompt-cache-policy"

describe("PromptCachePolicy.policyMode", () => {
  test("returns alibaba-explicit for alibaba-coding-plan", () => {
    expect(PromptCachePolicy.policyMode("alibaba-coding-plan")).toBe("alibaba-explicit")
  })

  test("returns alibaba-explicit for alibaba-token-plan-cn", () => {
    expect(PromptCachePolicy.policyMode("alibaba-token-plan-cn")).toBe("alibaba-explicit")
  })

  test("returns off for openrouter", () => {
    expect(PromptCachePolicy.policyMode("openrouter")).toBe("off")
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
    const result = PromptCachePolicy.render(blocks, "openrouter")
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
