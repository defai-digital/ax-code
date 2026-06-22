import path from "node:path"

type DeriveOptions = {
  worktree?: string
}

type Candidate = {
  pattern: string
  durable: boolean
}

const URL_KEYS = new Set(["url", "uri", "endpoint"])
const PATH_KEYS = new Set(["path", "file", "filePath", "filepath", "root", "directory"])
const SECRET_KEY = /(?:token|secret|password|credential|authorization|api[_-]?key)/i
const MAX_VALUE_LENGTH = 240
const MAX_PATTERNS = 8

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function scalar(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return undefined
}

function cap(value: string): string {
  return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}...` : value
}

function normalizeUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    parsed.username = parsed.username ? "[redacted]" : ""
    parsed.password = parsed.password ? "[redacted]" : ""
    parsed.hash = ""
    for (const key of [...parsed.searchParams.keys()]) {
      if (SECRET_KEY.test(key)) parsed.searchParams.set(key, "[redacted]")
    }
    return parsed.toString()
  } catch {
    return undefined
  }
}

function isOutsideRelativePath(relative: string) {
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
}

function normalizePath(value: string, worktree?: string): Candidate {
  const absolute = path.isAbsolute(value) ? path.normalize(value) : path.normalize(path.join(worktree ?? ".", value))
  if (!worktree) return { pattern: `path:${cap(value)}`, durable: false }

  const relative = path.relative(worktree, absolute)
  if (relative && !isOutsideRelativePath(relative)) {
    return { pattern: `path:${cap(relative)}`, durable: true }
  }

  return { pattern: "path:<external>", durable: false }
}

function addCandidate(output: Candidate[], seen: Set<string>, candidate: Candidate | undefined) {
  if (!candidate) return
  if (seen.has(candidate.pattern)) return
  seen.add(candidate.pattern)
  output.push(candidate)
}

function summarizeArgs(args: unknown): Record<string, unknown> {
  if (!isRecord(args)) return { type: typeof args }
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args).slice(0, 20)) {
    if (SECRET_KEY.test(key)) {
      result[key] = "[redacted]"
      continue
    }
    const text = scalar(value)
    if (text !== undefined) {
      result[key] = cap(text)
      continue
    }
    if (Array.isArray(value)) {
      result[key] = `[array:${value.length}]`
      continue
    }
    result[key] = isRecord(value) ? "[object]" : typeof value
  }
  return result
}

export namespace McpPermissionPattern {
  export type Result = {
    patterns: string[]
    always: string[]
    durable: boolean
    metadata: Record<string, unknown>
  }

  export function derive(tool: string, args: unknown, options: DeriveOptions = {}): Result {
    const candidates: Candidate[] = []
    const seen = new Set<string>()

    if (isRecord(args)) {
      const owner = scalar(args.owner)
      const repo = scalar(args.repo ?? args.repository)
      if (owner && repo) {
        addCandidate(candidates, seen, { pattern: `repo:${cap(owner)}/${cap(repo)}`, durable: true })
      } else if (repo && /^[^/\s]+\/[^/\s]+$/.test(repo)) {
        addCandidate(candidates, seen, { pattern: `repo:${cap(repo)}`, durable: true })
      }

      const database = scalar(args.database)
      const schema = scalar(args.schema)
      const table = scalar(args.table)
      if (database && table) {
        const suffix = schema ? `${database}.${schema}.${table}` : `${database}.${table}`
        addCandidate(candidates, seen, { pattern: `db:${cap(suffix)}`, durable: true })
      } else if (database) {
        addCandidate(candidates, seen, { pattern: `db:${cap(database)}`, durable: true })
      }

      for (const [key, value] of Object.entries(args)) {
        if (SECRET_KEY.test(key)) continue
        const text = scalar(value)
        if (!text) continue
        const normalizedKey = key.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase()
        if (URL_KEYS.has(normalizedKey)) {
          const normalized = normalizeUrl(text)
          addCandidate(
            candidates,
            seen,
            normalized ? { pattern: `${normalizedKey}:${cap(normalized)}`, durable: true } : undefined,
          )
          continue
        }
        if (PATH_KEYS.has(normalizedKey)) {
          addCandidate(candidates, seen, normalizePath(text, options.worktree))
          continue
        }
        if ((normalizedKey === "resource" || normalizedKey === "resourceid" || normalizedKey === "id") && text) {
          addCandidate(candidates, seen, { pattern: `${normalizedKey}:${cap(text)}`, durable: true })
        }
      }
    }

    const selected = candidates.slice(0, MAX_PATTERNS)
    const patterns = selected.length ? selected.map((candidate) => candidate.pattern) : ["*"]
    const durable = selected.length > 0 && selected.every((candidate) => candidate.durable)

    return {
      patterns,
      always: durable ? patterns : [],
      durable,
      metadata: {
        tool,
        durable,
        args: summarizeArgs(args),
      },
    }
  }
}
