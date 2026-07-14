/**
 * Detect OpenWiki binary and wiki directory state.
 */

import path from "path"
import { access, readFile, readdir } from "fs/promises"
import { execFile } from "child_process"
import { promisify } from "util"
import {
  INDEX_CANDIDATES,
  LAST_UPDATE_FILE,
  OPENWIKI_COMMAND_DEFAULT,
  WIKI_DIR_DEFAULT,
} from "./paths"

const execFileAsync = promisify(execFile)

export type WikiLastUpdate = {
  commit?: string
  timestamp?: string
  model?: string
  raw?: Record<string, unknown>
}

export type WikiBinaryInfo = {
  found: boolean
  path?: string
  command: string
}

export type WikiDetectResult = {
  root: string
  wikiDir: string
  wikiDirRelative: string
  wikiExists: boolean
  hasIndex: boolean
  indexPath?: string
  indexRelative?: string
  lastUpdate?: WikiLastUpdate
  binary: WikiBinaryInfo
  pageCount?: number
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve executable path for a command name using the platform `which`/`where`.
 * Returns undefined when not found.
 */
export async function resolveBinary(command: string): Promise<string | undefined> {
  if (!command || command.includes("/") || command.includes("\\")) {
    if (await exists(command)) return path.resolve(command)
    return undefined
  }

  // Prefer Node's PATH lookup via `which` / `where` without a shell.
  const whichCmd = process.platform === "win32" ? "where" : "which"
  try {
    const { stdout } = await execFileAsync(whichCmd, [command], {
      timeout: 5_000,
      windowsHide: true,
    })
    const first = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean)
    return first || undefined
  } catch {
    return undefined
  }
}

export function resolveWikiCommand(explicit?: string): string {
  return (explicit?.trim() || process.env.OPENWIKI_COMMAND?.trim() || OPENWIKI_COMMAND_DEFAULT).trim()
}

async function findIndex(wikiDir: string): Promise<string | undefined> {
  for (const name of INDEX_CANDIDATES) {
    const p = path.join(wikiDir, name)
    if (await exists(p)) return p
  }
  // Nested language dirs e.g. openwiki/en/quickstart.md
  try {
    const entries = await readdir(wikiDir, { withFileTypes: true })
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      for (const name of INDEX_CANDIDATES) {
        const p = path.join(wikiDir, ent.name, name)
        if (await exists(p)) return p
      }
    }
  } catch {
    // ignore
  }
  return undefined
}

async function countMarkdownPages(wikiDir: string): Promise<number> {
  let count = 0
  async function walk(dir: string) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git") continue
        await walk(full)
      } else if (ent.isFile() && ent.name.endsWith(".md")) {
        count++
      }
    }
  }
  await walk(wikiDir)
  return count
}

async function readLastUpdate(wikiDir: string): Promise<WikiLastUpdate | undefined> {
  const p = path.join(wikiDir, LAST_UPDATE_FILE)
  if (!(await exists(p))) return undefined
  try {
    const raw = JSON.parse(await readFile(p, "utf-8")) as Record<string, unknown>
    return {
      commit: typeof raw.commit === "string" ? raw.commit : typeof raw.sha === "string" ? raw.sha : undefined,
      timestamp:
        typeof raw.timestamp === "string"
          ? raw.timestamp
          : typeof raw.updatedAt === "string"
            ? raw.updatedAt
            : undefined,
      model: typeof raw.model === "string" ? raw.model : undefined,
      raw,
    }
  } catch {
    return undefined
  }
}

export async function detectWiki(input: {
  root: string
  dir?: string
  command?: string
}): Promise<WikiDetectResult> {
  const root = path.resolve(input.root)
  const wikiDirRelative = (input.dir?.trim() || WIKI_DIR_DEFAULT).replace(/\\/g, "/").replace(/\/+$/, "") || WIKI_DIR_DEFAULT
  const wikiDir = path.join(root, wikiDirRelative)
  const wikiExists = await exists(wikiDir)

  const command = resolveWikiCommand(input.command)
  const binaryPath = await resolveBinary(command)
  const binary: WikiBinaryInfo = {
    found: Boolean(binaryPath),
    path: binaryPath,
    command,
  }

  if (!wikiExists) {
    return {
      root,
      wikiDir,
      wikiDirRelative,
      wikiExists: false,
      hasIndex: false,
      binary,
    }
  }

  const indexPath = await findIndex(wikiDir)
  const lastUpdate = await readLastUpdate(wikiDir)
  const pageCount = await countMarkdownPages(wikiDir)

  return {
    root,
    wikiDir,
    wikiDirRelative,
    wikiExists: true,
    hasIndex: Boolean(indexPath),
    indexPath,
    indexRelative: indexPath ? path.relative(root, indexPath).replace(/\\/g, "/") : undefined,
    lastUpdate,
    binary,
    pageCount,
  }
}
