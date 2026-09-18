import type { FixedContextOutput } from "@ax-code/sdk/v2"

export type FixedQuestionState = {
  phase: "files" | "question" | "pending" | "result"
  files: string[]
  question: string
  error?: string
  result?: FixedContextOutput
}

// One dialog owns one request. Closing it prevents late replies from changing UI.
export function fixedContextQuestion(
  run: (files: string[], question: string, signal: AbortSignal) => Promise<FixedContextOutput>,
  changed: (state: FixedQuestionState) => void,
) {
  let state: FixedQuestionState = { phase: "files", files: [], question: "" }
  let controller: AbortController | undefined
  let closed = false
  const update = (next: Partial<FixedQuestionState>) => {
    if (closed) return
    state = { ...state, ...next }
    changed(state)
  }
  return {
    files(value: string) {
      const files = value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      if (!files.length || files.length > 14 || new Set(files).size !== files.length) {
        update({ error: "Select 1-14 distinct files, one path per line." })
        return
      }
      update({ files, phase: "question", error: undefined })
    },
    editFiles() {
      if (state.phase !== "pending") update({ phase: "files", error: undefined })
    },
    editQuestion() {
      if (state.phase !== "pending") update({ phase: "question", error: undefined })
    },
    async submit(question: string) {
      if (closed || state.phase === "pending") return
      if (!question.trim()) {
        update({ error: "Enter a question about the selected files." })
        return
      }
      controller = new AbortController()
      update({ phase: "pending", question, error: undefined, result: undefined })
      try {
        const result = await run([...state.files], question, controller.signal)
        update({ phase: "result", result })
      } catch (error) {
        const message =
          error && typeof error === "object" && "message" in error && typeof error.message === "string"
            ? error.message
            : "The question failed. Check the AX Trust connection and selected files."
        update({ phase: "question", error: message })
      }
    },
    close() {
      closed = true
      controller?.abort()
    },
  }
}
