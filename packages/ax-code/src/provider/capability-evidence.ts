/** Internal evidence survives snapshots but is never part of the public wire DTO. */
export type CapabilitySource = "catalog" | "config" | "deployment" | "heuristic" | "unknown"
export type CapabilityState = "supported" | "unsupported" | "unknown"
export type CapabilityName =
  | "thinking"
  | "toolCalling"
  | "structuredOutput"
  | "temperature"
  | "attachment"
  | "webSearch"
export type CapabilityEvidence = Readonly<
  Record<CapabilityName, Readonly<{ state: CapabilityState; source: CapabilitySource }>>
>
export type CapabilityDeclarations = Partial<Record<CapabilityName, unknown>>

const metadata = Symbol("modelCapabilityEvidence")
const names: CapabilityName[] = [
  "thinking",
  "toolCalling",
  "structuredOutput",
  "temperature",
  "attachment",
  "webSearch",
]

export function resolveCapabilityEvidence(
  declared: CapabilityDeclarations,
  source: CapabilitySource,
  previous?: CapabilityEvidence,
): CapabilityEvidence {
  return Object.freeze(
    Object.fromEntries(
      names.map((name) => {
        const value = declared[name]
        const item =
          typeof value === "boolean"
            ? { state: value ? "supported" : "unsupported", source }
            : (previous?.[name] ?? { state: "unknown", source: "unknown" })
        return [name, Object.freeze(item)]
      }),
    ) as Record<CapabilityName, CapabilityEvidence[CapabilityName]>,
  )
}

export function declaredCapabilityEvidence(value: object): CapabilityEvidence | undefined {
  return (value as { [metadata]?: CapabilityEvidence })[metadata]
}

export function withCapabilityEvidence<T extends object>(
  value: T,
  declared: CapabilityDeclarations,
  source: CapabilitySource,
  previous?: CapabilityEvidence,
): T {
  Object.defineProperty(value, metadata, {
    value: resolveCapabilityEvidence(declared, source, previous),
    configurable: true,
  })
  return value
}

export function modelCapabilityEvidence(flags: {
  reasoning?: boolean
  toolcall?: boolean
  temperature?: boolean
  attachment?: boolean
  websearch?: boolean
}): CapabilityEvidence {
  return (
    declaredCapabilityEvidence(flags) ??
    resolveCapabilityEvidence(
      {
        thinking: flags.reasoning,
        toolCalling: flags.toolcall,
        temperature: flags.temperature,
        attachment: flags.attachment,
        webSearch: flags.websearch,
      },
      "deployment",
    )
  )
}
