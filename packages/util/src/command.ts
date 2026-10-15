// Trim a configured command argv and drop it entirely when it is empty or any
// element is blank, so a half-filled command never reaches spawn. Shared by the
// core formatter config and the intel LSP server config, which previously
// carried byte-identical private copies.
export function normalizeCommand(command: string[] | undefined): string[] | undefined {
  if (command === undefined) return undefined
  const normalized = command.map((item) => item.trim())
  if (normalized.length === 0 || normalized.some((item) => item.length === 0)) return undefined
  return normalized
}
