import { EventEmitter } from "events"
import { afterEach, expect, test, vi } from "vitest"

const fakeInterface = new EventEmitter() as EventEmitter & { question: () => void; close: () => void }
fakeInterface.question = () => {}
fakeInterface.close = () => {}

vi.mock("readline", () => ({ default: { createInterface: () => fakeInterface }, createInterface: () => fakeInterface }))

const { confirmDestructiveAction } = await import("../../src/cli/confirm-destructive")

const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")

afterEach(() => {
  if (tty) Object.defineProperty(process.stdin, "isTTY", tty)
  else delete (process.stdin as { isTTY?: boolean }).isTTY
  fakeInterface.removeAllListeners()
  vi.restoreAllMocks()
})

// readline traps ^C in raw mode and only pauses, so the prompt's question()
// callback never fires; the confirmation must settle as "no" instead of hanging.
test("Ctrl+C at an interactive confirmation cancels instead of hanging", async () => {
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })
  vi.spyOn(process.stdout, "write").mockImplementation(() => true)
  const pending = confirmDestructiveAction("Proceed?")
  await vi.waitFor(() => expect(fakeInterface.listenerCount("SIGINT")).toBe(1))
  fakeInterface.emit("SIGINT")
  await expect(pending).resolves.toBe(false)
})
