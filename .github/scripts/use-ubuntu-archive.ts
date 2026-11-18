import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

const PRIMARY_ARCHIVE = "https://archive.ubuntu.com/ubuntu"
const REGIONAL_EC2_ARCHIVE = /^[a-z0-9-]+\.ec2\.archive\.ubuntu\.com$/i
const DEFAULT_SOURCES = ["/etc/apt/sources.list.d/ubuntu.sources", "/etc/apt/sources.list", "/etc/apt/apt-mirrors.txt"]

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
export function usePrimaryUbuntuArchive(text: string, format: "sources" | "list" | "mirrors"): string {
  let uriContinuation = false
  return text
    .split(/(?<=\n)/)
    .map((line) => {
      if (format === "mirrors") {
        return line.replace(/^([ \t]*)(https?:\/\/\S+)/i, (_match: string, prefix: string, uri: string) => {
          return prefix + rewriteUri(uri)
        })
      }
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
  const format =
    extension === ".sources"
      ? "sources"
      : extension === ".list"
        ? "list"
        : path.basename(file) === "apt-mirrors.txt"
          ? "mirrors"
          : undefined
  if (!path.isAbsolute(file) || !format) {
    throw new Error("Expected an absolute APT .sources, .list, or apt-mirrors.txt path")
  }
  await using entry = await fs
    .open(file, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      if (error.code === "ELOOP" || error.code === "EISDIR") throw new Error("APT source must be a regular file")
      throw error
    })
  if (!entry) return
  if (!(await entry.stat()).isFile()) throw new Error("APT source must be a regular file")
  const before = await entry.readFile("utf8")
  const after = usePrimaryUbuntuArchive(before, format)
  if (after === before) {
    process.stdout.write(`No regional EC2 archive to replace: ${file}\n`)
    return
  }
  // Keep the checked inode, its ownership and permissions. Positional writes
  // start at the beginning even though readFile advanced the handle's cursor.
  const content = Buffer.from(after)
  let offset = 0
  while (offset < content.length) {
    const { bytesWritten } = await entry.write(content, offset, content.length - offset, offset)
    if (bytesWritten === 0) throw new Error("Could not write APT source")
    offset += bytesWritten
  }
  await entry.truncate(content.length)
  process.stdout.write(`Use primary Ubuntu archive: ${file}\n`)
}

async function main(): Promise<void> {
  for (const file of process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_SOURCES) {
    await rewriteSources(file)
  }
}

if (import.meta.main) await main()
