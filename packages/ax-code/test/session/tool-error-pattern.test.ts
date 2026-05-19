import { describe, test, expect, afterEach } from "bun:test"
import { ToolErrorPatternTracker } from "../../src/session/tool-error-pattern"
import { SessionID } from "../../src/session/schema"

describe("ToolErrorPatternTracker", () => {
  const sessionID = SessionID.make("ses_test-pattern")

  afterEach(() => {
    ToolErrorPatternTracker.resetAll()
  })

  describe("record", () => {
    test("returns 1 on first occurrence", () => {
      const count = ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString in the file")
      expect(count).toBe(1)
    })

    test("increments count for same error pattern", () => {
      ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString in the file")
      const count = ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString in the file")
      expect(count).toBe(2)
    })

    test("normalizes numeric tokens in error messages", () => {
      ToolErrorPatternTracker.record(sessionID, "bash", "ENOENT: no such file, line 42")
      const count = ToolErrorPatternTracker.record(sessionID, "bash", "ENOENT: no such file, line 99")
      expect(count).toBe(2)
    })

    test("tracks different tools separately", () => {
      ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString")
      const count = ToolErrorPatternTracker.record(sessionID, "bash", "Could not find oldString")
      expect(count).toBe(1)
    })

    test("tracks different sessions separately", () => {
      const otherSession = SessionID.make("ses_other")
      ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString")
      const count = ToolErrorPatternTracker.record(otherSession, "edit", "Could not find oldString")
      expect(count).toBe(1)
    })

    test("records file paths", () => {
      ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString", "src/foo.ts")
      ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString", "src/bar.ts")
      const s = ToolErrorPatternTracker.stats(sessionID)
      expect(s.totalPatterns).toBe(1)
    })
  })

  describe("guidance", () => {
    test("returns null below threshold", () => {
      ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString in the file")
      ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString in the file")
      const g = ToolErrorPatternTracker.guidance(sessionID, "edit", "Could not find oldString in the file")
      expect(g).toBeNull()
    })

    test("returns guidance at threshold", () => {
      ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString in the file")
      ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString in the file")
      ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString in the file")
      const g = ToolErrorPatternTracker.guidance(sessionID, "edit", "Could not find oldString in the file")
      expect(g).not.toBeNull()
      expect(g).toContain("system-reminder")
      expect(g).toContain("oldString")
    })

    test("returns generic guidance for uncategorized patterns", () => {
      ToolErrorPatternTracker.record(sessionID, "bash", "some weird error xyz")
      ToolErrorPatternTracker.record(sessionID, "bash", "some weird error xyz")
      ToolErrorPatternTracker.record(sessionID, "bash", "some weird error xyz")
      const g = ToolErrorPatternTracker.guidance(sessionID, "bash", "some weird error xyz")
      expect(g).not.toBeNull()
      expect(g).toContain("same bash error")
    })

    test("returns edit:oldStringNotFound specific guidance", () => {
      for (let i = 0; i < 3; i++) {
        ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString in the file")
      }
      const g = ToolErrorPatternTracker.guidance(sessionID, "edit", "Could not find oldString in the file")
      expect(g).toContain("Read the file first with the Read tool")
    })

    test("returns bash:fileNotFound specific guidance", () => {
      for (let i = 0; i < 3; i++) {
        ToolErrorPatternTracker.record(sessionID, "bash", "ENOENT: no such file or directory")
      }
      const g = ToolErrorPatternTracker.guidance(sessionID, "bash", "ENOENT: no such file or directory")
      expect(g).toContain("Glob tool")
    })

    test("returns verify:typecheckFailed specific guidance", () => {
      for (let i = 0; i < 3; i++) {
        ToolErrorPatternTracker.record(sessionID, "verify", "typecheck failed with 5 errors")
      }
      const g = ToolErrorPatternTracker.guidance(sessionID, "verify", "typecheck failed with 5 errors")
      expect(g).toContain("type error")
    })

    test("returns verify:testFailed specific guidance", () => {
      for (let i = 0; i < 3; i++) {
        ToolErrorPatternTracker.record(sessionID, "verify", "test failed: expected true to be false")
      }
      const g = ToolErrorPatternTracker.guidance(sessionID, "verify", "test failed: expected true to be false")
      expect(g).toContain("test")
    })
  })

  describe("recordSuccess", () => {
    test("resets pattern count for that tool", () => {
      ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString")
      ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString")
      ToolErrorPatternTracker.recordSuccess(sessionID, "edit")
      const count = ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString")
      expect(count).toBe(1)
    })

    test("does not affect other tools", () => {
      ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString")
      ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString")
      ToolErrorPatternTracker.recordSuccess(sessionID, "bash")
      const count = ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString")
      expect(count).toBe(3)
    })
  })

  describe("reset", () => {
    test("clears all patterns for a session", () => {
      ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString")
      ToolErrorPatternTracker.record(sessionID, "bash", "ENOENT")
      ToolErrorPatternTracker.reset(sessionID)
      const s = ToolErrorPatternTracker.stats(sessionID)
      expect(s.totalPatterns).toBe(0)
    })

    test("does not affect other sessions", () => {
      const otherSession = SessionID.make("ses_other")
      ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString")
      ToolErrorPatternTracker.record(otherSession, "edit", "Could not find oldString")
      ToolErrorPatternTracker.reset(sessionID)
      const s = ToolErrorPatternTracker.stats(otherSession)
      expect(s.totalPatterns).toBe(1)
    })
  })

  describe("stats", () => {
    test("returns zero for empty session", () => {
      const s = ToolErrorPatternTracker.stats(sessionID)
      expect(s.totalPatterns).toBe(0)
      expect(s.totalOccurrences).toBe(0)
      expect(s.thresholdCrossed).toBe(0)
    })

    test("counts patterns and threshold crossings", () => {
      for (let i = 0; i < 5; i++) {
        ToolErrorPatternTracker.record(sessionID, "edit", "Could not find oldString")
      }
      for (let i = 0; i < 2; i++) {
        ToolErrorPatternTracker.record(sessionID, "bash", "ENOENT")
      }
      const s = ToolErrorPatternTracker.stats(sessionID)
      expect(s.totalPatterns).toBe(2)
      expect(s.totalOccurrences).toBe(7)
      expect(s.thresholdCrossed).toBe(1)
    })
  })

  describe("errorCategory", () => {
    test("classifies permission denied", () => {
      ToolErrorPatternTracker.record(sessionID, "bash", "permission denied: /etc/passwd")
      ToolErrorPatternTracker.record(sessionID, "bash", "permission denied: /etc/shadow")
      const s = ToolErrorPatternTracker.stats(sessionID)
      expect(s.totalPatterns).toBe(1) // same category despite different paths
    })

    test("classifies timeout", () => {
      ToolErrorPatternTracker.record(sessionID, "bash", "command timed out after 5000ms")
      ToolErrorPatternTracker.record(sessionID, "bash", "command timed out after 3000ms")
      const s = ToolErrorPatternTracker.stats(sessionID)
      expect(s.totalPatterns).toBe(1)
    })
  })
})
