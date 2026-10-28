import { expect, test, vi } from "vitest"
import { buildPrompt, createWatchLoop, extractAiComments, type AiComment } from "../../src/cli/cmd/watch-comments"

test("extractAiComments finds start and end markers in line comments", () => {
  const text = [
    "// AI! add a health check endpoint",
    "# AI? which python version is required",
    "-- AI! migrate the migration name",
    "; AI? what does this proc return",
    "// end marker at the end AI?",
    "-- trailing marker AI!",
  ].join("\n")

  const found = extractAiComments("file.txt", text)

  expect(found.map((comment) => [comment.line, comment.kind, comment.text])).toEqual([
    [1, "do", "add a health check endpoint"],
    [2, "ask", "which python version is required"],
    [3, "do", "migrate the migration name"],
    [4, "ask", "what does this proc return"],
    [5, "ask", "end marker at the end"],
    [6, "do", "trailing marker"],
  ])
})

test("extractAiComments supports slash-star and html block comments", () => {
  const text = [
    "/* AI! rewrite this block */",
    "<!-- AI? is this html valid -->",
    "/*",
    " * AI! inside a multi-line block",
    " */",
  ].join("\n")

  const found = extractAiComments("file.txt", text)

  expect(found.map((comment) => [comment.line, comment.kind, comment.text])).toEqual([
    [1, "do", "rewrite this block"],
    [2, "ask", "is this html valid"],
    [4, "do", "inside a multi-line block"],
  ])
})

test("extractAiComments requires a boundary so URLs and identifiers are ignored", () => {
  const text = ["const url = 'https://example.com/AI!x'", "const id = 'a--b'", "let x = 1 // no marker here"].join("\n")

  expect(extractAiComments("file.ts", text)).toEqual([])
})

test("extractAiComments ignores a bare marker with no instruction", () => {
  expect(extractAiComments("file.ts", "// AI!\n// AI?")).toEqual([])
})

test("extractAiComments returns numbered context around the comment", () => {
  const text = ["a", "b", "c", "// AI! do it", "d", "e", "f"].join("\n")

  const [comment] = extractAiComments("file.ts", text, { contextLines: 2 })

  expect(comment?.context).toBe(["2: b", "3: c", "4: // AI! do it", "5: d", "6: e"].join("\n"))
})

test("buildPrompt names the file, line, marker and context", () => {
  const comment: AiComment = { line: 4, kind: "do", text: "add tests", context: "4: // AI! add tests" }
  const prompt = buildPrompt({ file: "/work/repo/src/a.ts", comment, workdir: "/work/repo" })

  expect(prompt).toContain("src/a.ts:4")
  expect(prompt).toContain("Comment (AI!): add tests")
  expect(prompt).toContain("Files may be edited")
  expect(prompt).toContain("4: // AI! add tests")
})

test("buildPrompt for AI? asks for an answer only", () => {
  const comment: AiComment = { line: 1, kind: "ask", text: "what is x", context: "1: # AI? what is x" }
  const prompt = buildPrompt({ file: "notes.md", comment })

  expect(prompt).toContain("Comment (AI?): what is x")
  expect(prompt).toContain("Do not modify any files")
})

test("watch loop submits each distinct comment once and dedupes repeats of the same line", async () => {
  const submitted: string[] = []
  const loop = createWatchLoop({
    readFile: async () => "// AI! one\n// AI? two",
    submit: async (prompt: string) => {
      submitted.push(prompt)
    },
  })

  const count = await loop.processFile("/work/a.ts")

  expect(count).toBe(2)
  expect(submitted[0]).toContain("Comment (AI!): one")
  expect(submitted[1]).toContain("Comment (AI?): two")

  // A second pass over unchanged text must not resubmit.
  expect(await loop.processFile("/work/a.ts")).toBe(0)
})

test("watch loop drops events while a submission is running and never re-submits agent output", async () => {
  const submitted: string[] = []
  const files: Record<string, string> = { "/work/a.ts": "// AI! initial" }
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  const loop = createWatchLoop(
    {
      readFile: async (file) => files[file] ?? "",
      submit: async (prompt: string) => {
        submitted.push(prompt)
        await gate
      },
      sleep: async () => {},
    },
    { debounceMs: 0, graceMs: 0 },
  )

  // Start a submission and feed a watcher event while it is in flight.
  const inFlight = loop.processFile("/work/a.ts")
  loop.onChange("/work/a.ts")
  release()
  await inFlight
  await loop.idle()
  expect(submitted).toHaveLength(1)

  // The agent rewrote the file; the same comment text on a new line must not
  // be re-submitted because the file is marked agent-changed.
  files["/work/a.ts"] = "\n// AI! initial"
  await loop.processFile("/work/a.ts")
  expect(submitted).toHaveLength(1)
})

test("watch loop logs submission failures and keeps processing", async () => {
  const log = vi.fn()
  const loop = createWatchLoop({
    readFile: async () => "// AI! fail\n// AI! succeed",
    submit: async (prompt: string) => {
      // The context block can contain the other comment's text, so match the
      // authoritative "Comment (AI!): ..." line rather than the whole prompt.
      if (/Comment \(AI!\): fail/.test(prompt)) throw new Error("boom")
    },
    log,
  })

  const count = await loop.processFile("/work/a.ts")

  expect(count).toBe(1)
  expect(log).toHaveBeenCalledWith(expect.stringContaining("submission failed"))
})

test("extractAiComments drops the closer from a decorated block continuation line", () => {
  const comments = extractAiComments("/work/a.ts", "/*\n * AI! rename this */\nconst x = 1")
  expect(comments.map((comment) => comment.text)).toEqual(["rename this"])
})

test("watch loop keeps the agent window open until every overlapping run finishes", async () => {
  const submitted: string[] = []
  const files: Record<string, string> = {
    "/work/slow.ts": "// AI! slow",
    "/work/fast.ts": "// AI! fast",
    "/work/user.ts": "// AI! user",
  }
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  const loop = createWatchLoop(
    {
      readFile: async (file) => files[file] ?? "",
      submit: async (prompt: string) => {
        submitted.push(prompt)
        if (prompt.includes("Comment (AI!): slow")) await gate
      },
      sleep: async () => {},
    },
    { debounceMs: 0, graceMs: 0 },
  )

  const slow = loop.processFile("/work/slow.ts")
  await loop.processFile("/work/fast.ts")
  // The slow run is still in flight, so this change is the agent's.
  loop.onChange("/work/user.ts")
  release()
  await slow
  await loop.idle()
  expect(submitted.some((prompt) => prompt.includes("Comment (AI!): user"))).toBe(false)
})
