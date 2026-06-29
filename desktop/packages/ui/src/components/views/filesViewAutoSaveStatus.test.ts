import { afterEach, describe, expect, test, vi } from "vitest"
import {
  clearFilesViewAutoSaveIdleTimer,
  resetFilesViewAutoSaveStatus,
  showFilesViewAutoSaveSavedStatus,
  type FilesViewAutoSaveStatus,
} from "./filesViewAutoSaveStatus"

const createStatusRecorder = () => {
  const statuses: FilesViewAutoSaveStatus[] = []
  return {
    statuses,
    setStatus: (status: FilesViewAutoSaveStatus) => {
      statuses.push(status)
    },
  }
}

describe("filesViewAutoSaveStatus", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test("shows saved and then returns to idle after the delay", async () => {
    vi.useFakeTimers()
    const idleTimerRef = { current: null as ReturnType<typeof setTimeout> | null }
    const recorder = createStatusRecorder()

    showFilesViewAutoSaveSavedStatus(recorder.setStatus, idleTimerRef, 25)

    expect(recorder.statuses).toEqual(["saved"])
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(25)

    expect(recorder.statuses).toEqual(["saved", "idle"])
    expect(idleTimerRef.current).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  test("clears a previous idle timer when a newer save is shown", async () => {
    vi.useFakeTimers()
    const idleTimerRef = { current: null as ReturnType<typeof setTimeout> | null }
    const recorder = createStatusRecorder()

    showFilesViewAutoSaveSavedStatus(recorder.setStatus, idleTimerRef, 25)
    showFilesViewAutoSaveSavedStatus(recorder.setStatus, idleTimerRef, 50)

    expect(recorder.statuses).toEqual(["saved", "saved"])
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(25)
    expect(recorder.statuses).toEqual(["saved", "saved"])

    await vi.advanceTimersByTimeAsync(25)
    expect(recorder.statuses).toEqual(["saved", "saved", "idle"])
    expect(vi.getTimerCount()).toBe(0)
  })

  test("reset clears a pending idle timer before setting idle", async () => {
    vi.useFakeTimers()
    const idleTimerRef = { current: null as ReturnType<typeof setTimeout> | null }
    const recorder = createStatusRecorder()

    showFilesViewAutoSaveSavedStatus(recorder.setStatus, idleTimerRef, 25)
    resetFilesViewAutoSaveStatus(recorder.setStatus, idleTimerRef)

    expect(recorder.statuses).toEqual(["saved", "idle"])
    expect(idleTimerRef.current).toBeNull()
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(25)
    expect(recorder.statuses).toEqual(["saved", "idle"])
  })

  test("clear only removes the timer and does not change status", async () => {
    vi.useFakeTimers()
    const idleTimerRef = { current: null as ReturnType<typeof setTimeout> | null }
    const recorder = createStatusRecorder()

    showFilesViewAutoSaveSavedStatus(recorder.setStatus, idleTimerRef, 25)
    clearFilesViewAutoSaveIdleTimer(idleTimerRef)

    expect(recorder.statuses).toEqual(["saved"])
    expect(idleTimerRef.current).toBeNull()
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(25)
    expect(recorder.statuses).toEqual(["saved"])
  })
})
