const sourceRoot = "packages/ax-code/src/"

const cliEntries = new Set([
  `${sourceRoot}index.ts`,
  `${sourceRoot}index-compiled.ts`,
  `${sourceRoot}index-node.ts`,
  `${sourceRoot}index-node-tui.ts`,
])

// Runtime hosts use the shared HTTP/WS adapter (ADR-036 S1). That does not
// permit importing CLI startup, flags, commands or terminal presentation.
const serverHosts = new Set([
  ...cliEntries,
  `${sourceRoot}runtime/local-client.ts`,
  `${sourceRoot}mcp/oauth-callback.ts`,
  `${sourceRoot}control-plane/workspace-server/server.ts`,
])

function interfaceLayer(file: string): "cli" | "server" | undefined {
  for (const layer of ["cli", "server"] as const) {
    if (file === `${sourceRoot}${layer}` || file.startsWith(`${sourceRoot}${layer}/`)) return layer
  }
  return undefined
}

/** Import policy for resolved, repository-relative paths with forward slashes. */
export function runtimeInterfaceImportAllowed(file: string, target: string): boolean {
  const layer = interfaceLayer(target)
  if (!layer || interfaceLayer(file)) return true
  return layer === "cli" ? cliEntries.has(file) : serverHosts.has(file)
}

const moduleExtensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]

/** Return the public facade bypassed by this import, when that facade exists. */
export function requiredImplementationFacade(
  file: string,
  target: string,
  sourceFiles: ReadonlySet<string>,
): string | undefined {
  const module = target.replace(/\.(?:ts|tsx|js|jsx|mts|cts)$/, "")
  const suffix = "-impl"
  if (!module.endsWith(suffix)) return
  const base = module.slice(0, -suffix.length)
  const facades = moduleExtensions.map((extension) => base + extension).filter((facade) => sourceFiles.has(facade))
  if (facades.includes(file)) return
  return facades[0]
}
