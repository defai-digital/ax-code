import z from "zod"

const catalog = [
  {
    kind: "service_bootstrap",
    owner: "runtime",
    summary: "Startup, reload, or workspace-switch work stalls before required services become ready.",
    examples: ["first frame never appears", "bootstrap logs stop after project discovery"],
  },
  {
    kind: "event_queue_pressure",
    owner: "tui.queue",
    summary: "A bounded queue reaches sustained pressure and begins coalescing, dropping, or delaying updates.",
    examples: ["message deltas accumulate faster than flushes", "queue high-water mark stays near max depth"],
  },
  {
    kind: "focus_conflict",
    owner: "tui.focus",
    summary: "Two UI surfaces compete for the same input event or focus ownership.",
    examples: ["permission dialog and prompt both consume Enter", "keypress is handled by the wrong surface"],
  },
  {
    kind: "render_loop",
    owner: "renderer",
    summary: "The renderer repeatedly recomposes frames without converging on a stable interactive state.",
    examples: ["frame count spikes while state is unchanged", "resize produces repeated repaint churn"],
  },
  {
    kind: "transcript_projection",
    owner: "transcript",
    summary: "Transcript shaping, wrapping, or virtualization work exceeds the render budget.",
    examples: ["large append stalls UI updates", "long wrapped lines dominate frame time"],
  },
  {
    kind: "renderer_input",
    owner: "renderer.input",
    summary: "Terminal input parsing or renderer integration misclassifies keys, paste, mouse, or resize events.",
    examples: ["bracketed paste is truncated", "resize events stop reaching the active surface"],
  },
  {
    kind: "worker_stream",
    owner: "worker",
    summary: "Worker RPC or server event streaming stalls, disconnects, or reorders updates.",
    examples: ["SSE reconnect loop prevents fresh events", "worker fetch succeeds but event stream goes quiet"],
  },
] as const

export namespace RuntimeFailureClass {
  export const Kind = z
    .enum([
      "service_bootstrap",
      "event_queue_pressure",
      "focus_conflict",
      "render_loop",
      "transcript_projection",
      "renderer_input",
      "worker_stream",
    ])
    .describe("Failure classes used to triage TUI non-response reports")
  export type Kind = z.infer<typeof Kind>

  export const Info = z
    .object({
      kind: Kind.describe("Stable failure class identifier"),
      owner: z.string().min(1).describe("Primary subsystem expected to own the fix"),
      summary: z.string().min(1).describe("Short description of the failure class"),
      examples: z
        .array(z.string().min(1).describe("Representative signal for the failure class"))
        .min(1)
        .describe("Examples of symptoms that should map into the failure class"),
    })
    .strict()
  export type Info = z.infer<typeof Info>

  const parsed = catalog.map((item) => Info.parse(item))

  export function list(): Info[] {
    return parsed.map((item) => ({
      ...item,
      examples: [...item.examples],
    }))
  }

  export function get(kind: Kind): Info {
    const item = parsed.find((entry) => entry.kind === kind)
    if (!item) {
      throw new Error(`Unknown runtime failure class: ${kind}`)
    }
    return {
      ...item,
      examples: [...item.examples],
    }
  }
}
