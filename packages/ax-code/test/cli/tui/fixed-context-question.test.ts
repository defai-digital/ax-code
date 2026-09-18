import { expect, test, vi } from "vitest"
import { fixedContextQuestion, type FixedQuestionState } from "../../../src/cli/tui/component/fixed-context-question"

const answer = {
  answer: "43",
  cache: { status: "HIT" as const },
  contextDigest: "digest",
  providerID: "trust",
  modelID: "model",
}

test("fixed questions retain filenames with spaces and rerequest each explicit question", async () => {
  const run = vi.fn(async () => answer)
  let state!: FixedQuestionState
  const question = fixedContextQuestion(run, (value) => {
    state = value
  })
  question.files("src/my file.ts\nREADME.md")
  expect(state.files).toEqual(["src/my file.ts", "README.md"])
  await question.submit("What does it return?")
  expect(state.phase).toBe("result")
  expect(state.result?.cache.status).toBe("HIT")
  question.editQuestion()
  await question.submit("Describe the return value.")
  expect(run).toHaveBeenCalledTimes(2)
})

test("rejects empty or duplicate file selections before sending a question", () => {
  const run = vi.fn()
  let state!: FixedQuestionState
  const question = fixedContextQuestion(run, (value) => {
    state = value
  })
  for (const input of ["", "file\nfile", Array.from({ length: 15 }, (_, i) => String(i)).join("\n")]) {
    question.files(input)
    expect(state.phase).toBe("files")
    expect(state.error).toContain("distinct files")
  }
  expect(run).not.toHaveBeenCalled()
})

test("closing cancels transport and suppresses late results without duplicate submissions", async () => {
  const deferred = Promise.withResolvers<typeof answer>()
  let signal!: AbortSignal
  const run = vi.fn(async (_files, _question, value: AbortSignal) => {
    signal = value
    return deferred.promise
  })
  const changed = vi.fn()
  const question = fixedContextQuestion(run, changed)
  question.files("value.py")
  const pending = question.submit("What does it return?")
  await question.submit("Repeated enter")
  expect(run).toHaveBeenCalledTimes(1)
  question.close()
  expect(signal.aborted).toBe(true)
  changed.mockClear()
  deferred.resolve(answer)
  await pending
  expect(changed).not.toHaveBeenCalled()
})

test("server errors leave the selected files and question available for correction", async () => {
  let state!: FixedQuestionState
  const question = fixedContextQuestion(
    async () => {
      throw { message: "Read permission is not allowed." }
    },
    (value) => {
      state = value
    },
  )
  question.files("private.env")
  await question.submit("Describe this file.")
  expect(state).toMatchObject({
    phase: "question",
    files: ["private.env"],
    question: "Describe this file.",
    error: "Read permission is not allowed.",
  })
})
