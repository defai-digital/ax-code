import { afterEach, test, expect } from "bun:test"
import { Question } from "../../src/question"
import { Instance } from "../../src/project/instance"
import { QuestionID } from "../../src/question/schema"
import { tmpdir } from "../fixture/fixture"
import { SessionID } from "../../src/session/schema"

afterEach(async () => {
  await Instance.disposeAll()
})

/** Reject all pending questions so dangling Deferred fibers don't hang the test. */
async function rejectAll() {
  const pending = await Question.list()
  for (const req of pending) {
    await Question.reject(req.id)
  }
}

test("ask - returns pending promise", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const promise = Question.ask({
        sessionID: SessionID.make("ses_test"),
        questions: [
          {
            question: "What would you like to do?",
            header: "Action",
            options: [
              { label: "Option 1", description: "First option" },
              { label: "Option 2", description: "Second option" },
            ],
          },
        ],
      })
      expect(promise).toBeInstanceOf(Promise)
      await rejectAll()
      await promise.catch(() => {})
    },
  })
})

test("ask - adds to pending list", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const questions = [
        {
          question: "What would you like to do?",
          header: "Action",
          options: [
            { label: "Option 1", description: "First option" },
            { label: "Option 2", description: "Second option" },
          ],
        },
      ]

      const askPromise = Question.ask({
        sessionID: SessionID.make("ses_test"),
        questions,
      })

      const pending = await Question.list()
      expect(pending.length).toBe(1)
      expect(pending[0].questions).toEqual(questions)
      await rejectAll()
      await askPromise.catch(() => {})
    },
  })
})

// reply tests

test("reply - resolves the pending ask with answers", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const questions = [
        {
          question: "What would you like to do?",
          header: "Action",
          options: [
            { label: "Option 1", description: "First option" },
            { label: "Option 2", description: "Second option" },
          ],
        },
      ]

      const askPromise = Question.ask({
        sessionID: SessionID.make("ses_test"),
        questions,
      })

      const pending = await Question.list()
      const requestID = pending[0].id

      await Question.reply({
        requestID,
        answers: [["Option 1"]],
      })

      const answers = await askPromise
      expect(answers).toEqual([["Option 1"]])
    },
  })
})

test("reply - removes from pending list", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const askPromise = Question.ask({
        sessionID: SessionID.make("ses_test"),
        questions: [
          {
            question: "What would you like to do?",
            header: "Action",
            options: [
              { label: "Option 1", description: "First option" },
              { label: "Option 2", description: "Second option" },
            ],
          },
        ],
      })

      const pending = await Question.list()
      expect(pending.length).toBe(1)

      await Question.reply({
        requestID: pending[0].id,
        answers: [["Option 1"]],
      })
      await askPromise

      const pendingAfter = await Question.list()
      expect(pendingAfter.length).toBe(0)
    },
  })
})

test("reply - does nothing for unknown requestID", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Question.reply({
        requestID: QuestionID.make("que_unknown"),
        answers: [["Option 1"]],
      })
      // Should not throw
    },
  })
})

// reject tests

test("reject - throws RejectedError", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const askPromise = Question.ask({
        sessionID: SessionID.make("ses_test"),
        questions: [
          {
            question: "What would you like to do?",
            header: "Action",
            options: [
              { label: "Option 1", description: "First option" },
              { label: "Option 2", description: "Second option" },
            ],
          },
        ],
      })

      const pending = await Question.list()
      await Question.reject(pending[0].id)

      await expect(askPromise).rejects.toBeInstanceOf(Question.RejectedError)
    },
  })
})

test("reject - removes from pending list", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const askPromise = Question.ask({
        sessionID: SessionID.make("ses_test"),
        questions: [
          {
            question: "What would you like to do?",
            header: "Action",
            options: [
              { label: "Option 1", description: "First option" },
              { label: "Option 2", description: "Second option" },
            ],
          },
        ],
      })

      const pending = await Question.list()
      expect(pending.length).toBe(1)

      await Question.reject(pending[0].id)
      askPromise.catch(() => {}) // Ignore rejection

      const pendingAfter = await Question.list()
      expect(pendingAfter.length).toBe(0)
    },
  })
})

test("reject - does nothing for unknown requestID", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Question.reject(QuestionID.make("que_unknown"))
      // Should not throw
    },
  })
})

// multiple questions tests

test("ask - handles multiple questions", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const questions = [
        {
          question: "What would you like to do?",
          header: "Action",
          options: [
            { label: "Build", description: "Build the project" },
            { label: "Test", description: "Run tests" },
          ],
        },
        {
          question: "Which environment?",
          header: "Env",
          options: [
            { label: "Dev", description: "Development" },
            { label: "Prod", description: "Production" },
          ],
        },
      ]

      const askPromise = Question.ask({
        sessionID: SessionID.make("ses_test"),
        questions,
      })

      const pending = await Question.list()

      await Question.reply({
        requestID: pending[0].id,
        answers: [["Build"], ["Dev"]],
      })

      const answers = await askPromise
      expect(answers).toEqual([["Build"], ["Dev"]])
    },
  })
})

test("ask - autonomous mode escalates low-confidence multi-option to user (PRD v4.2.0 P0-2)", async () => {
  await using tmp = await tmpdir({ git: true })
  const original = process.env.AX_CODE_AUTONOMOUS
  process.env.AX_CODE_AUTONOMOUS = "true"
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Two options with no best-practice/risk markers — heuristic
        // scorer cannot pick a winner, so confidence is "low" and the
        // ask() should escalate to a pending request rather than
        // auto-answer.
        const askPromise = Question.ask({
          sessionID: SessionID.make("ses_auto_escalate"),
          questions: [
            {
              question: "Pick a color",
              header: "Color",
              options: [
                { label: "Apple", description: "the fruit" },
                { label: "Banana", description: "another fruit" },
              ],
            },
          ],
        })

        // The escalated request should appear in the pending list.
        // Poll briefly because Config.get() is async on the escalation path.
        let pending: Awaited<ReturnType<typeof Question.list>> = []
        for (let i = 0; i < 50; i++) {
          pending = await Question.list()
          if (pending.length > 0) break
          await new Promise((r) => setTimeout(r, 10))
        }
        expect(pending).toHaveLength(1)

        await Question.reply({ requestID: pending[0]!.id, answers: [["Apple"]] })
        const answers = await askPromise
        expect(answers).toEqual([["Apple"]])
      },
    })
  } finally {
    if (original === undefined) delete process.env.AX_CODE_AUTONOMOUS
    else process.env.AX_CODE_AUTONOMOUS = original
  }
})

test("ask - autonomous mode answers single-option questions", async () => {
  await using tmp = await tmpdir({ git: true })
  const original = process.env.AX_CODE_AUTONOMOUS
  process.env.AX_CODE_AUTONOMOUS = "true"
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const answers = await Question.ask({
          sessionID: SessionID.make("ses_auto_single"),
          questions: [
            {
              question: "Only option?",
              header: "Only",
              options: [{ label: "Continue", description: "Continue automatically" }],
            },
          ],
        })

        expect(answers).toEqual([["Continue"]])
        expect(await Question.list()).toEqual([])
      },
    })
  } finally {
    if (original === undefined) delete process.env.AX_CODE_AUTONOMOUS
    else process.env.AX_CODE_AUTONOMOUS = original
  }
})

test("ask - autonomous mode decides multi-option questions", async () => {
  await using tmp = await tmpdir({ git: true })
  const original = process.env.AX_CODE_AUTONOMOUS
  process.env.AX_CODE_AUTONOMOUS = "true"
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const answers = await Question.ask({
          sessionID: SessionID.make("ses_auto_multi"),
          questions: [
            {
              question: "Pick one?",
              header: "Pick",
              options: [
                { label: "A", description: "First option" },
                { label: "B", description: "Second option (recommended)" },
              ],
            },
          ],
        })

        expect(answers).toEqual([["B"]])
        expect(await Question.list()).toEqual([])
      },
    })
  } finally {
    if (original === undefined) delete process.env.AX_CODE_AUTONOMOUS
    else process.env.AX_CODE_AUTONOMOUS = original
  }
})

test("ask - autonomous mode avoids over-engineered options", async () => {
  await using tmp = await tmpdir({ git: true })
  const original = process.env.AX_CODE_AUTONOMOUS
  process.env.AX_CODE_AUTONOMOUS = "true"
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const answers = await Question.ask({
          sessionID: SessionID.make("ses_auto_pragmatic"),
          questions: [
            {
              question: "Which approach?",
              header: "Approach",
              options: [
                { label: "Rewrite", description: "Large refactor with a complex new abstraction" },
                { label: "Minimal fix", description: "Simple common best practice" },
              ],
            },
          ],
        })

        expect(answers).toEqual([["Minimal fix"]])
      },
    })
  } finally {
    if (original === undefined) delete process.env.AX_CODE_AUTONOMOUS
    else process.env.AX_CODE_AUTONOMOUS = original
  }
})

test("ask - autonomous mode treats over-engineering risk as stronger than recommended label", async () => {
  await using tmp = await tmpdir({ git: true })
  const original = process.env.AX_CODE_AUTONOMOUS
  process.env.AX_CODE_AUTONOMOUS = "true"
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const answers = await Question.ask({
          sessionID: SessionID.make("ses_auto_recommended_but_complex"),
          questions: [
            {
              question: "Which approach?",
              header: "Approach",
              options: [
                { label: "Rewrite (Recommended)", description: "Complex large refactor" },
                { label: "Small patch", description: "Targeted fix only" },
              ],
            },
          ],
        })

        expect(answers).toEqual([["Small patch"]])
      },
    })
  } finally {
    if (original === undefined) delete process.env.AX_CODE_AUTONOMOUS
    else process.env.AX_CODE_AUTONOMOUS = original
  }
})

test("ask - autonomous mode avoids risky recommended options in multi-select questions", async () => {
  await using tmp = await tmpdir({ git: true })
  const original = process.env.AX_CODE_AUTONOMOUS
  process.env.AX_CODE_AUTONOMOUS = "true"
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const answers = await Question.ask({
          sessionID: SessionID.make("ses_auto_multi_risk"),
          questions: [
            {
              question: "Which actions?",
              header: "Actions",
              multiple: true,
              options: [
                { label: "Rewrite (Recommended)", description: "Complex large refactor" },
                { label: "Add focused test", description: "Simple best practice" },
                { label: "Minimal fix", description: "Common safe change" },
              ],
            },
          ],
        })

        expect(answers).toEqual([["Add focused test", "Minimal fix"]])
      },
    })
  } finally {
    if (original === undefined) delete process.env.AX_CODE_AUTONOMOUS
    else process.env.AX_CODE_AUTONOMOUS = original
  }
})

test("ask - autonomous mode treats avoid over-engineering as a positive signal", async () => {
  await using tmp = await tmpdir({ git: true })
  const original = process.env.AX_CODE_AUTONOMOUS
  process.env.AX_CODE_AUTONOMOUS = "true"
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const answers = await Question.ask({
          sessionID: SessionID.make("ses_auto_avoid_overengineering"),
          questions: [
            {
              question: "Which approach?",
              header: "Approach",
              options: [
                { label: "Architecture rewrite", description: "New framework layer" },
                { label: "Avoid over-engineering", description: "Keep scope narrow" },
              ],
            },
          ],
        })

        expect(answers).toEqual([["Avoid over-engineering"]])
      },
    })
  } finally {
    if (original === undefined) delete process.env.AX_CODE_AUTONOMOUS
    else process.env.AX_CODE_AUTONOMOUS = original
  }
})

test("ask - autonomous mode uses question context to prefer low-scope options", async () => {
  await using tmp = await tmpdir({ git: true })
  const original = process.env.AX_CODE_AUTONOMOUS
  process.env.AX_CODE_AUTONOMOUS = "true"
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const answers = await Question.ask({
          sessionID: SessionID.make("ses_auto_context_low_scope"),
          questions: [
            {
              question: "Which approach best avoids over-engineering?",
              header: "Approach",
              options: [
                { label: "New architecture layer", description: "Framework layer for future extension" },
                { label: "Patch existing function", description: "Small targeted change" },
              ],
            },
          ],
        })

        expect(answers).toEqual([["Patch existing function"]])
      },
    })
  } finally {
    if (original === undefined) delete process.env.AX_CODE_AUTONOMOUS
    else process.env.AX_CODE_AUTONOMOUS = original
  }
})

// list tests

test("list - returns all pending requests", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const p1 = Question.ask({
        sessionID: SessionID.make("ses_test1"),
        questions: [
          {
            question: "Question 1?",
            header: "Q1",
            options: [{ label: "A", description: "A" }],
          },
        ],
      })

      const p2 = Question.ask({
        sessionID: SessionID.make("ses_test2"),
        questions: [
          {
            question: "Question 2?",
            header: "Q2",
            options: [{ label: "B", description: "B" }],
          },
        ],
      })

      const pending = await Question.list()
      expect(pending.length).toBe(2)
      await rejectAll()
      p1.catch(() => {})
      p2.catch(() => {})
    },
  })
})

test("list - returns empty when no pending", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const pending = await Question.list()
      expect(pending.length).toBe(0)
    },
  })
})

test("questions stay isolated by directory", async () => {
  await using one = await tmpdir({ git: true })
  await using two = await tmpdir({ git: true })

  const p1 = Instance.provide({
    directory: one.path,
    fn: () =>
      Question.ask({
        sessionID: SessionID.make("ses_one"),
        questions: [
          {
            question: "Question 1?",
            header: "Q1",
            options: [{ label: "A", description: "A" }],
          },
        ],
      }),
  })

  const p2 = Instance.provide({
    directory: two.path,
    fn: () =>
      Question.ask({
        sessionID: SessionID.make("ses_two"),
        questions: [
          {
            question: "Question 2?",
            header: "Q2",
            options: [{ label: "B", description: "B" }],
          },
        ],
      }),
  })

  const onePending = await Instance.provide({
    directory: one.path,
    fn: () => Question.list(),
  })
  const twoPending = await Instance.provide({
    directory: two.path,
    fn: () => Question.list(),
  })

  expect(onePending.length).toBe(1)
  expect(twoPending.length).toBe(1)
  expect(onePending[0].sessionID).toBe(SessionID.make("ses_one"))
  expect(twoPending[0].sessionID).toBe(SessionID.make("ses_two"))

  await Instance.provide({
    directory: one.path,
    fn: () => Question.reject(onePending[0].id),
  })
  await Instance.provide({
    directory: two.path,
    fn: () => Question.reject(twoPending[0].id),
  })

  await p1.catch(() => {})
  await p2.catch(() => {})
})

test("pending question rejects on instance dispose", async () => {
  await using tmp = await tmpdir({ git: true })

  const ask = Instance.provide({
    directory: tmp.path,
    fn: () => {
      return Question.ask({
        sessionID: SessionID.make("ses_dispose"),
        questions: [
          {
            question: "Dispose me?",
            header: "Dispose",
            options: [{ label: "Yes", description: "Yes" }],
          },
        ],
      })
    },
  })
  const result = ask.then(
    () => "resolved" as const,
    (err) => err,
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const pending = await Question.list()
      expect(pending).toHaveLength(1)
      await Instance.dispose()
    },
  })

  expect(await result).toBeInstanceOf(Question.RejectedError)
})

test("pending question rejects on instance reload", async () => {
  await using tmp = await tmpdir({ git: true })

  const ask = Instance.provide({
    directory: tmp.path,
    fn: () => {
      return Question.ask({
        sessionID: SessionID.make("ses_reload"),
        questions: [
          {
            question: "Reload me?",
            header: "Reload",
            options: [{ label: "Yes", description: "Yes" }],
          },
        ],
      })
    },
  })
  const result = ask.then(
    () => "resolved" as const,
    (err) => err,
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const pending = await Question.list()
      expect(pending).toHaveLength(1)
      await Instance.reload({ directory: tmp.path })
    },
  })

  expect(await result).toBeInstanceOf(Question.RejectedError)
})
