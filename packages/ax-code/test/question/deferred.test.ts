import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest"
import { Question } from "../../src/question"
import { Instance } from "../../src/project/instance"
import { QuestionID } from "../../src/question/schema"
import { tmpdir } from "../fixture/fixture"
import { SessionID } from "../../src/session/schema"

// ADR-222 deferred questions: askDeferred records the question through the
// existing pending machinery and returns immediately; reply() delivers the
// answer to the session once (steering when busy, follow-up queue when idle);
// reject() delivers nothing. The delivery lazy-imports the session modules,
// so fake sinks replace them here.

const mocks = vi.hoisted(() => ({
  steeringView: vi.fn(),
  promptSteer: vi.fn(),
  enqueueIdempotent: vi.fn(),
  executorStart: vi.fn(),
}))

vi.mock("../../src/session/steering", () => ({
  SessionSteering: { view: mocks.steeringView },
}))
vi.mock("../../src/session/prompt", () => ({
  SessionPrompt: { steer: mocks.promptSteer },
}))
vi.mock("../../src/session/task-queue", () => ({
  TaskQueue: { enqueueIdempotent: mocks.enqueueIdempotent },
}))
vi.mock("../../src/session/task-queue-executor", () => ({
  TaskQueueExecutor: { start: mocks.executorStart },
}))

const ORIGINAL_AUTONOMOUS = process.env.AX_CODE_AUTONOMOUS
beforeAll(() => {
  process.env.AX_CODE_AUTONOMOUS = "false"
})
afterAll(() => {
  if (ORIGINAL_AUTONOMOUS === undefined) delete process.env.AX_CODE_AUTONOMOUS
  else process.env.AX_CODE_AUTONOMOUS = ORIGINAL_AUTONOMOUS
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.steeringView.mockReturnValue({ generation: null, receipts: [], retention: "test" })
  mocks.promptSteer.mockResolvedValue({ status: "accepted" })
  mocks.enqueueIdempotent.mockResolvedValue({ id: "tq_deferred" })
  mocks.executorStart.mockResolvedValue(undefined)
})

afterEach(async () => {
  await Instance.disposeAll()
})

const QUESTIONS = [
  {
    question: "Which database?",
    header: "Database",
    options: [
      { label: "Postgres", description: "Relational default" },
      { label: "SQLite", description: "Embedded" },
    ],
  },
]

/** Wait until the fire-and-forget delivery reaches a sink. */
async function until(cond: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (cond()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("condition was not met before timeout")
}

test("askDeferred - records the question and returns immediately", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const id = await Question.askDeferred({
        sessionID: SessionID.make("ses_deferred"),
        questions: QUESTIONS,
      })
      expect(QuestionID.zod.safeParse(id).success).toBe(true)

      const pending = await Question.list()
      expect(pending).toHaveLength(1)
      expect(pending[0].id).toBe(id)
      expect(pending[0].deferred).toBe(true)
      expect(pending[0].questions).toEqual(QUESTIONS)
    },
  })
})

test("reply - delivers a deferred answer once through steering when a generation is active", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const id = await Question.askDeferred({
        sessionID: SessionID.make("ses_deferred_busy"),
        questions: QUESTIONS,
      })
      mocks.steeringView.mockReturnValue({
        generation: "11111111-1111-1111-1111-111111111111",
        receipts: [],
        retention: "test",
      })

      const applied = await Question.reply({ requestID: id, answers: [["Postgres"]] })
      expect(applied).toBe(true)

      await until(() => mocks.promptSteer.mock.calls.length > 0)
      expect(mocks.promptSteer).toHaveBeenCalledTimes(1)
      const call = mocks.promptSteer.mock.calls[0]!
      expect(call[0]).toBe(SessionID.make("ses_deferred_busy"))
      expect(call[1].clientID).toBe(`question_${id}`)
      expect(call[1].expectedGeneration).toBe("11111111-1111-1111-1111-111111111111")
      expect(call[1].text).toContain("Answer to your deferred question: Which database? -> Postgres")
      // The busy path steers; it never touches the follow-up queue.
      expect(mocks.enqueueIdempotent).not.toHaveBeenCalled()

      // At-most-once: the entry is gone, a duplicate reply neither resolves
      // anything nor delivers a second message.
      expect(await Question.list()).toHaveLength(0)
      const again = await Question.reply({ requestID: id, answers: [["SQLite"]] })
      expect(again).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(mocks.promptSteer).toHaveBeenCalledTimes(1)
    },
  })
})

test("reply - queues a deferred answer as the next follow-up when the session is idle", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const id = await Question.askDeferred({
        sessionID: SessionID.make("ses_deferred_idle"),
        questions: QUESTIONS,
      })
      // Default mock: generation null (idle).

      const applied = await Question.reply({ requestID: id, answers: [["SQLite"]] })
      expect(applied).toBe(true)

      await until(() => mocks.enqueueIdempotent.mock.calls.length > 0)
      expect(mocks.promptSteer).not.toHaveBeenCalled()
      expect(mocks.enqueueIdempotent).toHaveBeenCalledTimes(1)
      const input = mocks.enqueueIdempotent.mock.calls[0]![0] as Record<string, any>
      expect(input.sessionID).toBe(SessionID.make("ses_deferred_idle"))
      expect(input.kind).toBe("followup")
      expect(input.sourceMessageID).toBe(`question_${id}`)
      const parts = (input.payload as { body: { parts: { type: string; text?: string }[] } }).body.parts
      expect(parts).toHaveLength(1)
      expect(parts[0]?.type).toBe("text")
      expect(parts[0]?.text).toContain("Which database? -> SQLite")
      expect(mocks.executorStart).toHaveBeenCalledTimes(1)
    },
  })
})

test("reply - falls back to the follow-up queue when the steer is refused", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const id = await Question.askDeferred({
        sessionID: SessionID.make("ses_deferred_refused"),
        questions: QUESTIONS,
      })
      mocks.steeringView.mockReturnValue({
        generation: "22222222-2222-2222-2222-222222222222",
        receipts: [],
        retention: "test",
      })
      mocks.promptSteer.mockResolvedValue({ status: "rejected", reason: "admission_rejected" })

      await Question.reply({ requestID: id, answers: [["Postgres"]] })

      await until(() => mocks.enqueueIdempotent.mock.calls.length > 0)
      expect(mocks.promptSteer).toHaveBeenCalledTimes(1)
      expect(mocks.enqueueIdempotent).toHaveBeenCalledTimes(1)
      expect(mocks.executorStart).toHaveBeenCalledTimes(1)
    },
  })
})

test("reject - removes the deferred question and delivers nothing", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const id = await Question.askDeferred({
        sessionID: SessionID.make("ses_deferred_reject"),
        questions: QUESTIONS,
      })
      mocks.steeringView.mockReturnValue({
        generation: "33333333-3333-3333-3333-333333333333",
        receipts: [],
        retention: "test",
      })

      const applied = await Question.reject(id)
      expect(applied).toBe(true)
      expect(await Question.list()).toHaveLength(0)

      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(mocks.promptSteer).not.toHaveBeenCalled()
      expect(mocks.enqueueIdempotent).not.toHaveBeenCalled()
      expect(mocks.executorStart).not.toHaveBeenCalled()
    },
  })
})

test("deferred questions survive the turn ending but expire with the instance", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // No abort signal exists for a deferred question; the turn ending has
      // no effect on the pending entry (unlike ask()).
      await Question.askDeferred({
        sessionID: SessionID.make("ses_deferred_survive"),
        questions: QUESTIONS,
      })
      expect(await Question.list()).toHaveLength(1)

      await Instance.dispose()
      expect(await Question.list()).toHaveLength(0)
    },
  })
})

test("Request schema stays additive - deferred is optional", () => {
  const base = {
    id: QuestionID.make("que_schema"),
    sessionID: SessionID.make("ses_schema"),
    questions: QUESTIONS,
  }
  expect(Question.Request.safeParse(base).success).toBe(true)
  expect(Question.Request.safeParse({ ...base, deferred: true }).success).toBe(true)
  const parsed = Question.Request.parse({ ...base, deferred: true })
  expect(parsed.deferred).toBe(true)
})

test("deferredAnswerText composes and clips the delivery text", () => {
  expect(Question.deferredAnswerText(QUESTIONS, [["Postgres"]])).toBe(
    "Answer to your deferred question: Which database? -> Postgres",
  )
  expect(Question.deferredAnswerText([...QUESTIONS, ...QUESTIONS], [["Postgres"], ["SQLite"]])).toBe(
    "Answers to your deferred questions: Which database? -> Postgres; Which database? -> SQLite",
  )
  const long = Question.deferredAnswerText(
    [{ ...QUESTIONS[0]!, question: "x".repeat(20_000), header: "Long", options: [] }],
    [["Postgres"]],
  )
  expect(long.length).toBeLessThanOrEqual(16_000)
})
