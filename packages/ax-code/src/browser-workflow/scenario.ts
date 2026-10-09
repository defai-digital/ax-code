import z from "zod"
import { createHash } from "node:crypto"
import { WebMcpProfile } from "../mcp/webmcp-profile"

export namespace BrowserScenario {
  export const VERSION = "1"
  export const Hash = z.string().regex(/^[a-f0-9]{64}$/)
  const text = z.string().min(1).max(512)
  export const Locator = z
    .object({
      role: z.enum([
        "button",
        "textbox",
        "searchbox",
        "link",
        "heading",
        "checkbox",
        "radio",
        "combobox",
        "option",
        "status",
        "listitem",
      ]),
      name: text,
    })
    .strict()
  export const Assertion = z
    .object({
      locator: Locator,
      property: z.enum(["count", "value", "checked", "disabled"]),
      equals: z.union([z.string().max(512), z.number().int().min(0).max(100), z.boolean()]),
    })
    .strict()
    .superRefine((value, ctx) => {
      const expected = value.property === "count" ? "number" : value.property === "value" ? "string" : "boolean"
      if (typeof value.equals !== expected)
        ctx.addIssue({ code: "custom", message: `Expected ${expected} assertion value` })
    })
  const reference = z
    .object({
      file: text,
      line: z.number().int().min(1),
      column: z.number().int().min(0).default(0),
      map: text.optional(),
    })
    .strict()
  const action = z.discriminatedUnion("action", [
    z.object({ action: z.literal("click"), locator: Locator }).strict(),
    z.object({ action: z.literal("fill"), locator: Locator, value: z.string().max(1024) }).strict(),
    z.object({ action: z.literal("hover"), locator: Locator }).strict(),
    z
      .object({
        action: z.literal("assert"),
        assertion: Assertion,
        timeoutMs: z.number().int().min(0).max(10000).default(0),
      })
      .strict(),
    z
      .object({
        action: z.literal("contract"),
        name: text,
        descriptorHash: Hash,
        input: z.record(z.string(), z.unknown()),
        expectError: z.boolean().default(false),
        resultPath: z.array(text).max(8).default([]),
        equals: z.unknown(),
      })
      .strict(),
  ])
  export const Manifest = z
    .object({
      version: z.literal(1),
      name: text,
      server: z
        .string()
        .min(1)
        .max(2048)
        .refine((value) => value.includes("{port}"), "Server command must contain {port}"),
      path: z
        .string()
        .max(1024)
        .default("/")
        .refine(
          (value) => value.startsWith("/") && !value.startsWith("//") && !/[\\\r\n?#]/.test(value),
          "Use an origin-relative path without query or fragment",
        ),
      setup: z.array(z.string().min(1).max(2048)).max(3).default([]),
      reset: z.array(z.string().min(1).max(2048)).max(3).default([]),
      cleanup: z.array(z.string().min(1).max(2048)).max(3).default([]),
      steps: z.array(action).min(1).max(32),
      sources: z.array(reference).max(8).default([]),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (WebMcpProfile.credentialLike(JSON.stringify(value)))
        ctx.addIssue({ code: "custom", message: "Credentials are not allowed in scenarios" })
      if (Buffer.byteLength(JSON.stringify(value)) > 32768)
        ctx.addIssue({ code: "custom", message: "Scenario exceeds 32 KiB" })
      if (!value.steps.some((step) => step.action === "assert" || step.action === "contract"))
        ctx.addIssue({ code: "custom", message: "Scenario requires an assertion" })
      const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
      while (pending.length) {
        const item = pending.pop()!
        if (item.depth > 16) {
          ctx.addIssue({ code: "custom", message: "Scenario nesting exceeds 16 levels" })
          break
        }
        if (item.value && typeof item.value === "object")
          for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 })
      }
      for (const step of value.steps) {
        if (
          step.action === "fill" &&
          WebMcpProfile.sensitiveTarget({ ...step.locator, uid: "", focused: false, attributes: {} })
        )
          ctx.addIssue({ code: "custom", message: "Credential targets are not supported" })
      }
    })
  export type Manifest = z.infer<typeof Manifest>
  export type Locator = z.infer<typeof Locator>
  export type Assertion = z.infer<typeof Assertion>
  export type Step = Manifest["steps"][number]
  export type Identity = { revision: string; tree: string }
  export type Frozen = { hash: string; baseline: Identity; manifest: Manifest; runner: string; bridge: string }

  export function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
    if (value && typeof value === "object")
      return `{${Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
        .join(",")}}`
    return JSON.stringify(value) ?? "null"
  }
  export function digest(value: unknown): string {
    return createHash("sha256").update(canonical(value)).digest("hex")
  }
  export function freeze(value: unknown, baseline: Identity): Frozen {
    const manifest = Manifest.parse(value)
    const body = { manifest, baseline, runner: VERSION, bridge: WebMcpProfile.PACKAGE }
    return { ...body, hash: digest(body) }
  }
  export function matches(nodes: Iterable<WebMcpProfile.SnapshotNode>, locator: Locator) {
    return [...nodes].filter((node) => node.role === locator.role && node.name === locator.name)
  }
  export function assert(
    nodes: Iterable<WebMcpProfile.SnapshotNode>,
    assertion: Assertion,
  ): "pass" | "fail" | "unknown" {
    const found = matches(nodes, assertion.locator)
    if (assertion.property === "count") return found.length === assertion.equals ? "pass" : "fail"
    if (found.length !== 1) return "unknown"
    const actual = found[0]!.attributes[assertion.property]
    if (actual === undefined) return "unknown"
    return actual === assertion.equals ? "pass" : "fail"
  }
}
