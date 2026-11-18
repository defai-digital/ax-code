import fs from "node:fs/promises"
import path from "node:path"

const PRIMARY_ARCHIVE = "https://archive.ubuntu.com/ubuntu"
const REGIONAL_EC2_ARCHIVE = /^[a-z0-9-]+\.ec2\.archive\.ubuntu\.com$/i
const DEFAULT_SOURCES = ["/etc/apt/sources.list.d/ubuntu.sources", "/etc/apt/sources.list"]

function rewriteUri(token: string): string {
  if (!/^https?:\/\//i.test(token)) return token
  let uri: URL
  try {
    uri = new URL(token)
  } catch {
    return token
  }
  if (
    !REGIONAL_EC2_ARCHIVE.test(uri.hostname) ||
    uri.username ||
    uri.password ||
    uri.port ||
    uri.search ||
    uri.hash ||
    (uri.pathname !== "/ubuntu" && uri.pathname !== "/ubuntu/")
  )
    return token
  return PRIMARY_ARCHIVE + (uri.pathname.endsWith("/") ? "/" : "")
}

/** Replace only active EC2 Ubuntu archive URIs; retain suites, components and signing keys. */
export function usePrimaryUbuntuArchive(text: string, format: "sources" | "list"): string {
  let uriContinuation = false
  return text
    .split(/(?<=\n)/)
    .map((line) => {
      if (format === "list") {
        return line.replace(
          /^(\s*deb(?:-src)?\s+(?:\[[^\]]*\]\s+)?)(\S+)/,
          (_match: string, prefix: string, uri: string) => prefix + rewriteUri(uri),
        )
      }
      const field = /^([A-Za-z][A-Za-z0-9-]*):/.exec(line)
      const fieldName = field?.[1]
      if (fieldName) uriContinuation = fieldName.toLowerCase() === "uris"
      else if (!/^[ \t]/.test(line)) uriContinuation = false
      if (!uriContinuation || /^\s*#/.test(line)) return line
      let comment = false
      return line.replace(/\S+/g, (token) => {
        if (token.startsWith("#")) comment = true
        return comment ? token : rewriteUri(token)
      })
    })
    .join("")
}

async function rewriteSources(file: string): Promise<void> {
  const extension = path.extname(file)
  if (!path.isAbsolute(file) || (extension !== ".sources" && extension !== ".list")) {
    throw new Error("Expected an absolute APT .sources or .list path")
  }
  const entry = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return
    throw error
  })
  if (!entry) return
  if (!entry.isFile()) throw new Error("APT source must be a regular file")
  const before = await fs.readFile(file, "utf8")
  const after = usePrimaryUbuntuArchive(before, extension === ".sources" ? "sources" : "list")
  if (after === before) return
  // This setup step runs before APT in an ephemeral CI runner. Updating the
  // existing file retains its mode and owner without changing signing policy.
  await fs.writeFile(file, after)
  process.stdout.write(`Use primary Ubuntu archive: ${file}\n`)
}

async function main(): Promise<void> {
  for (const file of process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_SOURCES) {
    await rewriteSources(file)
  }
}

if (import.meta.main) await main()
