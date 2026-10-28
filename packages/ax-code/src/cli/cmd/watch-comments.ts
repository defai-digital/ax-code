/**
 * Pure helpers for `ax-code watch` (ADR-228).
 *
 * extractAiComments / buildPrompt are fully deterministic text functions.
 * createWatchLoop holds the debounce + loop-guard state and takes every
 * side effect (read, submit, sleep, clock) as an injected dependency so the
 * loop can be exercised with fakes in tests.
 *
 * Loop guard (ADR-228 D3): watcher events that arrive while a submission is
 * running — or within a short grace window after it finished — are dropped
 * and their files are marked agent-changed. A comment in an agent-changed
 * file is only submitted when its text was never submitted from that file
 * before: the agent rewriting a file can move a comment to a new line, and
 * the (file, line) signature would otherwise look new and re-submit forever.
 * ax-code never rewrites the comment line itself.
 */

export type AiCommentKind = "do" | "ask"

export interface AiComment {
  /** 1-based line number of the comment. */
  line: number
  /** "do" for AI!, "ask" for AI?. */
  kind: AiCommentKind
  /** Instruction text with the AI!/AI? marker removed. */
  text: string
  /** Numbered surrounding lines (context before and after). */
  context: string
}

export interface ExtractOptions {
  /** Lines of context before/after the comment line. Default 2. */
  contextLines?: number
}

const MARKER_START = /^(AI!|AI\?)\s*(.*)$/
const MARKER_END = /^(.*?)\s*(AI!|AI\?)$/

type BlockKind = "slash" | "html"

const LINE_OPENERS = ["//", "#", "--", ";"] as const
const BLOCK_OPENERS: Array<{ kind: BlockKind; token: string; closer: string }> = [
  // Order matters: "<!--" must win over "--", "/*" is unrelated to "//".
  { kind: "html", token: "<!--", closer: "-->" },
  { kind: "slash", token: "/*", closer: "*/" },
]

function classify(content: string): { kind: AiCommentKind; text: string } | undefined {
  const trimmed = content.trim()
  if (!trimmed) return
  const start = MARKER_START.exec(trimmed)
  if (start) {
    const text = start[2]!.trim()
    if (!text) return
    return { kind: start[1] === "AI!" ? "do" : "ask", text }
  }
  const end = MARKER_END.exec(trimmed)
  if (end) {
    const text = end[1]!.trim()
    if (!text) return
    return { kind: end[2] === "AI!" ? "do" : "ask", text }
  }
  return
}

/**
 * Extract AI! / AI? comments from source text. Supported comment styles:
 * //, #, --, ;, single-line slash-star and HTML block comments, and
 * multi-line block comments (each line inside a block is checked
 * independently).
 */
export function extractAiComments(file: string, text: string, options: ExtractOptions = {}): AiComment[] {
  const contextLines = options.contextLines ?? 2
  const lines = text.split(/\r?\n/)
  const comments: AiComment[] = []
  let inBlock: BlockKind | undefined

  const push = (index: number, content: string) => {
    const found = classify(content)
    if (!found) return
    const from = Math.max(0, index - contextLines)
    const to = Math.min(lines.length, index + 1 + contextLines)
    comments.push({
      line: index + 1,
      kind: found.kind,
      text: found.text,
      context: lines
        .slice(from, to)
        .map((line, offset) => `${from + offset + 1}: ${line}`)
        .join("\n"),
    })
  }

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!

    if (inBlock !== undefined) {
      const closer = BLOCK_OPENERS.find((entry) => entry.kind === inBlock)!.closer
      let content = raw
      if (inBlock === "slash") content = content.replace(/^\s*\*?/, "")
      // Index the closer in the stripped text the slice applies to.
      const closeAt = content.indexOf(closer)
      if (closeAt !== -1) {
        content = content.slice(0, closeAt)
        inBlock = undefined
      }
      push(index, content)
      continue
    }

    // A block opener anywhere on the line starts a block comment; HTML and
    // slash comments are checked first so "<!--" is never read as "--".
    const block = BLOCK_OPENERS.map((entry) => ({ entry, at: raw.indexOf(entry.token) }))
      .filter((candidate) => candidate.at !== -1)
      .sort((a, b) => a.at - b.at)[0]
    if (block) {
      let content = raw.slice(block.at + block.entry.token.length)
      const closeAt = content.indexOf(block.entry.closer)
      if (closeAt !== -1) {
        content = content.slice(0, closeAt)
      } else {
        inBlock = block.entry.kind
      }
      push(index, content)
      continue
    }

    // Line comments: the opener must start the line or follow whitespace so
    // URLs ("https://") and identifiers ("a--b") are not misread.
    let lineComment: { token: string; at: number } | undefined
    for (const token of LINE_OPENERS) {
      const at = findLineOpener(raw, token)
      if (at === -1) continue
      if (!lineComment || at < lineComment.at) lineComment = { token, at }
    }
    if (lineComment) {
      push(index, raw.slice(lineComment.at + lineComment.token.length))
    }
  }

  return comments
}

function findLineOpener(raw: string, token: string): number {
  const trimmedStart = raw.length - raw.trimStart().length
  for (let at = raw.indexOf(token); at !== -1; at = raw.indexOf(token, at + 1)) {
    if (at < trimmedStart) continue
    if (at === trimmedStart || /\s/.test(raw[at - 1]!)) return at
  }
  return -1
}

/** Build the ordinary prompt submitted for one found comment. */
export function buildPrompt(input: { file: string; comment: AiComment; workdir?: string }): string {
  const rel = input.workdir ? relativeWithin(input.workdir, input.file) : input.file
  const marker = input.comment.kind === "do" ? "AI!" : "AI?"
  const header =
    input.comment.kind === "do"
      ? "[watch] The user left an AI! comment in the workspace. Complete the instruction in that comment. Files may be edited as needed, subject to the normal permission profile."
      : "[watch] The user left an AI? comment in the workspace. Answer the question in that comment only. Do not modify any files."
  return [
    header,
    `File: ${rel}:${input.comment.line}`,
    `Comment (${marker}): ${input.comment.text}`,
    "",
    "Context:",
    input.comment.context,
  ].join("\n")
}

function relativeWithin(workdir: string, file: string): string {
  const rel = pathRelative(workdir, file)
  return rel && !rel.startsWith("..") ? rel : file
}

// path.sep-based prefix check without importing node:path so the module
// stays dependency-free and trivially testable.
function pathRelative(from: string, to: string): string {
  const fromParts = normalizePath(from).split("/")
  const toParts = normalizePath(to).split("/")
  let shared = 0
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) shared++
  const up = fromParts.length - shared
  const down = toParts.slice(shared).join("/")
  if (up === 0) return down
  if (shared === toParts.length) return ""
  return [...Array(up).fill(".."), down].join("/")
}

function normalizePath(value: string): string {
  return value.replace(/\/+$/, "").replace(/\\/g, "/")
}

export interface WatchLoopDeps {
  readFile: (file: string) => Promise<string>
  submit: (prompt: string, comment: AiComment, file: string) => Promise<void>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  log?: (message: string) => void
}

export interface WatchLoopOptions {
  /** Per-file debounce window. Default 500ms. */
  debounceMs?: number
  /** Window after a submission ends that still counts as agent-caused. Default 2000ms. */
  graceMs?: number
}

export interface WatchLoop {
  /** Feed one watcher event (file add/change) into the loop. */
  onChange: (file: string) => void
  /** Immediate one-shot pass over a file; returns the number of submitted comments. */
  processFile: (file: string) => Promise<number>
  /** Resolves when every pending debounce task and submission settled. */
  idle: () => Promise<void>
}

export function createWatchLoop(deps: WatchLoopDeps, options: WatchLoopOptions = {}): WatchLoop {
  const debounceMs = options.debounceMs ?? 500
  const graceMs = options.graceMs ?? 2000
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const log = deps.log ?? (() => {})

  // Files debounce independently, so several runs can overlap; the first one
  // to finish must not end the agent window for the others.
  let running = 0
  let runEndedAt = Number.NEGATIVE_INFINITY
  const agentChanged = new Set<string>()
  const submittedSignatures = new Set<string>()
  const submittedTexts = new Map<string, Set<string>>()
  const generations = new Map<string, number>()
  const pending = new Set<Promise<unknown>>()

  function agentWindowActive(): boolean {
    return running > 0 || now() - runEndedAt < graceMs
  }

  function track(task: Promise<unknown>) {
    pending.add(task)
    void task.finally(() => pending.delete(task))
  }

  async function processFile(file: string): Promise<number> {
    // Mark the run active synchronously, before the first await: a watcher
    // event that fires right after a submission starts must be attributed to
    // the agent, and `onChange` runs synchronously from the watcher callback.
    running++
    try {
      let text: string
      try {
        text = await deps.readFile(file)
      } catch {
        return 0
      }
      const comments = extractAiComments(file, text)
      let submitted = 0
      for (const comment of comments) {
        const signature = `${file}|${comment.line}|${comment.kind}|${comment.text}`
        if (submittedSignatures.has(signature)) continue
        if (agentChanged.has(file) && submittedTexts.get(file)?.has(comment.text)) {
          log(`watch: skip agent-changed ${file}:${comment.line} (already submitted)`)
          continue
        }
        submittedSignatures.add(signature)
        const texts = submittedTexts.get(file) ?? new Set<string>()
        submittedTexts.set(file, texts)
        texts.add(comment.text)
        log(`watch: submit ${comment.kind === "do" ? "AI!" : "AI?"} from ${file}:${comment.line}`)
        try {
          await deps.submit(buildPrompt({ file, comment }), comment, file)
          submitted++
        } catch (error) {
          log(
            `watch: submission failed for ${file}:${comment.line}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
      return submitted
    } finally {
      running--
      runEndedAt = now()
    }
  }

  function onChange(file: string): void {
    if (agentWindowActive()) {
      agentChanged.add(file)
      generations.delete(file)
      return
    }
    const generation = (generations.get(file) ?? 0) + 1
    generations.set(file, generation)
    track(
      (async () => {
        await sleep(debounceMs)
        if (generations.get(file) !== generation) return
        generations.delete(file)
        await processFile(file)
      })(),
    )
  }

  return {
    onChange,
    processFile,
    idle: () => Promise.all([...pending]).then(() => undefined),
  }
}
