import path from "path"
import os from "os"
import fs from "fs/promises"
import { pathToFileURL } from "url"
import { Agent } from "../../agent/agent"
import { ConfigMarkdown } from "../../config/markdown"
import { Instance } from "../../project/instance"
import { Filesystem } from "../../util/filesystem"
import { Process } from "../../util/process"
import { Ssrf } from "../../util/ssrf"
import { wrapUntrustedContent } from "../../util/untrusted-content"
import { isAdr236Reference, parseReferenceToken, type ReferenceToken } from "./prompt-reference-parser"

// ADR-236 caps. Mirrored in the parser; repeated here so the runner can apply
// the same limit without re-importing the parser constants.
const MAX_EXPANSION_BYTES = 30 * 1024

// 10 commits, matching the parser's MAX_GIT_COUNT.
const MAX_GIT_COUNT = 10

export interface ReferenceRunners {
  /** Run a git argv; resolves to the trimmed stdout (or empty on non-zero exit). */
  runGit(args: string[]): Promise<string>
  /** Fetch a URL through the SSRF-pinned path. Resolves to response text. */
  fetchUrl(href: string): Promise<string>
}

export const defaultReferenceRunners: ReferenceRunners = {
  async runGit(args) {
    const result = await Process.text(["git", ...args], {
      cwd: Instance.worktree,
      nothrow: true,
    }).catch(() => ({ text: "", code: 1 }) as { text: string; code: number })
    return result.code === 0 ? result.text : ""
  },
  async fetchUrl(href) {
    const response = await Ssrf.pinnedFetch(href, { label: "webfetch" })
    if (!response.ok) return ""
    const text = await response.text().catch(() => "")
    return text
  },
}

function truncateExpansion(body: string, label: string): string {
  if (Buffer.byteLength(body, "utf8") <= MAX_EXPANSION_BYTES) return body
  // Slice UTF-8 bytes, not UTF-16 code units, so multibyte content stays
  // within the advertised cap.
  const capped = Buffer.from(body, "utf8").subarray(0, MAX_EXPANSION_BYTES).toString("utf8")
  return `${capped}\n[truncated: ${label} exceeded ${MAX_EXPANSION_BYTES} bytes]`
}

function inlineNote(message: string): any {
  return { type: "text", text: message }
}

async function expandGitDiff(args: string[], label: string, runners: ReferenceRunners): Promise<any[]> {
  try {
    const text = truncateExpansion(await runners.runGit(args), label)
    if (!text) return [inlineNote(`[${label} is empty]`)]
    return [{ type: "text", text }]
  } catch (err) {
    return [inlineNote(`[${label} failed: ${(err as Error).message}]`)]
  }
}

async function expandGitLog(count: number, runners: ReferenceRunners): Promise<any[]> {
  try {
    const text = truncateExpansion(
      await runners.runGit(["log", "-n", String(count), "-p", "--no-color"]),
      `git:log:${count}`,
    )
    if (!text) return [inlineNote(`[git:log:${count} is empty]`)]
    return [{ type: "text", text }]
  } catch (err) {
    return [inlineNote(`[git:log:${count} failed: ${(err as Error).message}]`)]
  }
}

async function expandFileRange(
  name: string,
  start: number,
  end: number | undefined,
  match: RegExpMatchArray,
): Promise<any[]> {
  const label = `@file:${name}:${start}${end ? `-${end}` : ""}`
  try {
    // Resolve like a plain @path: only `~/` leaves the worktree.
    const filepath = name.startsWith("~/")
      ? path.resolve(os.homedir(), name.slice(2))
      : path.resolve(Instance.worktree, name)
    const checked = await fs.realpath(filepath).catch(() => undefined)
    if (!checked) return [inlineNote(`[${label} not found]`)]

    const allowed = name.startsWith("~/")
      ? Filesystem.contains(os.homedir(), checked)
      : Filesystem.contains(Instance.worktree, checked)
    if (!allowed) return [inlineNote(`[${label} is outside the workspace]`)]

    const stats = await fs.stat(checked).catch(() => undefined)
    if (!stats?.isFile()) return [inlineNote(`[${label} is not a file]`)]

    // Home ranges must pass the attachment path's external-directory
    // permission gate, so emit a normal file part instead of embedding
    // content here. The attachment layer reads the 1-based range via the
    // 0-based start/end query parameters.
    if (name.startsWith("~/")) {
      const params = new URLSearchParams({ start: String(start - 1) })
      if (end !== undefined) params.set("end", String(end - 1))
      return [
        {
          type: "file",
          url: `${pathToFileURL(checked).href}?${params.toString()}`,
          filename: name,
          mime: "text/plain",
          source: {
            type: "file",
            path: checked,
            text: {
              value: match[0],
              start: match.index ?? 0,
              end: (match.index ?? 0) + match[0].length,
            },
          },
        },
      ]
    }

    const content = await fs.readFile(checked, "utf8")
    const lines = content.split(/\r?\n/)
    const total = lines.length
    const startIdx = Math.max(0, Math.min(total, start - 1))
    const endIdx = end !== undefined ? Math.min(total, end) : total
    if (startIdx >= endIdx) {
      return [inlineNote(`[${label} is out of range (file has ${total} lines)]`)]
    }
    const selected = lines.slice(startIdx, endIdx)
    const header = `<file_range path="${name}" start="${start}"${end !== undefined ? ` end="${end}"` : ""}>`
    const body = truncateExpansion(selected.join("\n"), label)
    return [{ type: "text", text: `${header}\n${body}\n</file_range>` }]
  } catch (err) {
    return [inlineNote(`[${label} failed: ${(err as Error).message}]`)]
  }
}

async function expandUrl(href: string, runners: ReferenceRunners): Promise<any[]> {
  try {
    const text = truncateExpansion(await runners.fetchUrl(href), `@url:${href}`)
    if (!text) return [inlineNote(`[@url:${href} returned no content]`)]
    return [{ type: "text", text: wrapUntrustedContent(text, "@url") }]
  } catch (err) {
    return [inlineNote(`[@url:${href} failed: ${(err as Error).message}]`)]
  }
}

async function expandReference(
  token: ReferenceToken,
  runners: ReferenceRunners,
  match: RegExpMatchArray,
): Promise<any[]> {
  switch (token.kind) {
    case "diff":
      return expandGitDiff(["diff", "--no-color"], "@diff", runners)
    case "staged":
      return expandGitDiff(["diff", "--cached", "--no-color"], "@staged", runners)
    case "git":
      return expandGitLog(Math.min(MAX_GIT_COUNT, token.count), runners)
    case "file-range":
      return expandFileRange(token.path, token.start, token.end, match)
    case "url":
      return expandUrl(token.href, runners)
    default:
      return []
  }
}

export async function resolvePromptParts(template: string, options?: { runners?: ReferenceRunners }): Promise<any[]> {
  const runners = options?.runners ?? defaultReferenceRunners
  const parts: any[] = [
    {
      type: "text",
      text: template,
    },
  ]
  const files = ConfigMarkdown.files(template)
  const seen = new Set<string>()
  for (const match of files) {
    const name = match[1]
    if (seen.has(name)) continue
    seen.add(name)

    // ADR-236: try the new pure-parser forms first. On miss fall through to
    // the existing @file / @agent resolution.
    const token = parseReferenceToken(name)
    if (token && isAdr236Reference(token)) {
      const expanded = await expandReference(token, runners, match)
      parts.push(...expanded)
      continue
    }
    if (token && !isAdr236Reference(token)) {
      // Not a new form and not @file / @agent. Skip silently — the parser is
      // strict so this only fires for unrecognised strings.
      continue
    }

    const filepath = name.startsWith("~/")
      ? path.resolve(os.homedir(), name.slice(2))
      : path.resolve(Instance.worktree, name)
    const checkedPath = await fs.realpath(filepath).catch((error) => {
      if (!Filesystem.isMissingPathError(error)) throw error
      return undefined
    })
    if (!checkedPath) {
      const agent = await Agent.get(name)
      if (agent) {
        parts.push({
          type: "agent",
          name: agent.name,
        })
      }
      continue
    }

    if (name.startsWith("~/") && !Filesystem.contains(os.homedir(), checkedPath)) {
      continue
    }

    if (!name.startsWith("~/") && !Filesystem.contains(Instance.worktree, checkedPath)) {
      continue
    }

    const stats = await fs.stat(checkedPath).catch((error) => {
      if (!Filesystem.isMissingPathError(error)) throw error
      return undefined
    })
    if (!stats) continue

    // Only @~/ parts carry a FileSource marker so the attachment layer can
    // recognize a home reference that legitimately lives outside the project.
    const homeSource = name.startsWith("~/")
      ? {
          source: {
            type: "file" as const,
            path: checkedPath,
            text: {
              value: match[0],
              start: match.index ?? 0,
              end: (match.index ?? 0) + match[0].length,
            },
          },
        }
      : {}

    if (stats.isDirectory()) {
      parts.push({
        type: "file",
        url: pathToFileURL(checkedPath).href,
        filename: name,
        mime: "application/x-directory",
        ...homeSource,
      })
      continue
    }

    parts.push({
      type: "file",
      url: pathToFileURL(checkedPath).href,
      filename: name,
      mime: "text/plain",
      ...homeSource,
    })
  }
  return parts
}
