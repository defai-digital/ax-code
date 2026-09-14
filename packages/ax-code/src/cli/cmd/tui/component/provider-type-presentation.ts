import type { MessageKey, Translate } from "../i18n"

const types: Record<string, { title?: MessageKey; description: MessageKey }> = {
  api: { title: "provider.cloud", description: "provider.cloudHint" },
  cli: { title: "provider.cli", description: "provider.cliHint" },
  local: { title: "provider.local", description: "provider.localHint" },
  "ax-engine": { description: "provider.engineHint" },
  "private-gpu": { title: "provider.private", description: "provider.privateHint" },
  "ax-trust": { description: "provider.trustHint" },
}

export function providerTypePresentation(
  value: string,
  t: Translate,
): { title?: string; description?: string; hint?: string } {
  const entry = types[value]
  if (!entry) return {}
  return { ...(entry.title ? { title: t(entry.title) } : {}), description: t(entry.description), hint: undefined }
}
