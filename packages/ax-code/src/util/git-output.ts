export interface NameStatusEntry {
  code: string
  file: string
}

export interface NumstatEntry {
  file: string
  additions: number
  deletions: number
  binary: boolean
}

function decodePath(file: string) {
  if (!file.startsWith('"')) return file
  try {
    return JSON.parse(file) as string
  } catch {
    return file
  }
}

function splitPair(line: string) {
  const idx = line.indexOf("\t")
  if (idx < 0) return
  return [line.slice(0, idx), decodePath(line.slice(idx + 1))] as const
}

function parseCount(value: string) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export function parsePathLine(line: string): string | undefined {
  if (!line) return
  const file = decodePath(line)
  return file || undefined
}

export function parseNameStatusLine(line: string): NameStatusEntry | undefined {
  const parsed = splitPair(line)
  if (!parsed) return
  const [code, file] = parsed
  if (!code || !file) return
  return { code, file }
}

export function parseNumstatLine(line: string): NumstatEntry | undefined {
  const first = line.indexOf("\t")
  if (first < 0) return
  const second = line.indexOf("\t", first + 1)
  if (second < 0) return

  const rawAdditions = line.slice(0, first)
  const rawDeletions = line.slice(first + 1, second)
  const file = decodePath(line.slice(second + 1))
  if (!file) return

  const binary = rawAdditions === "-" && rawDeletions === "-"
  return {
    file,
    additions: binary ? 0 : parseCount(rawAdditions),
    deletions: binary ? 0 : parseCount(rawDeletions),
    binary,
  }
}

export function parseLsTreeSize(line: string): number | undefined {
  const parsed = splitPair(line)
  const meta = parsed?.[0]
  if (!meta) return

  const parts = meta.trim().split(/\s+/)
  const raw = parts[3]
  if (!raw || raw === "-") return

  const size = Number.parseInt(raw, 10)
  return Number.isFinite(size) ? size : undefined
}
