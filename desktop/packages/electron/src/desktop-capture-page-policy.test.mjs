import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

const readContract = async () => {
  const raw = await readFile(path.join(import.meta.dirname, "desktop-ipc-contract.json"), "utf8")
  return JSON.parse(raw)
}

const extractHandleCommandCall = (source, command) => {
  const start = source.indexOf(`handleCommand(\n  "${command}"`)
  if (start < 0) return ""

  let depth = 0
  let quote = null
  let escaped = false

  for (let index = start + "handleCommand".length; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char
      continue
    }
    if (char === "(") depth += 1
    if (char === ")") {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }

  return source.slice(start)
}

describe("desktop capture page IPC policy", () => {
  test("keeps window pixel capture local-only", async () => {
    const contract = await readContract()
    const command = contract.commands.find((entry) => entry.command === "desktop_capture_page_rect")

    expect(command).toMatchObject({ safeForRemote: false })
  })

  test("does not mark the capture handler as remote-safe", async () => {
    const mainSource = await readFile(path.join(import.meta.dirname, "main.js"), "utf8")
    const handler = extractHandleCommandCall(mainSource, "desktop_capture_page_rect")

    expect(handler).toContain("desktop_capture_page_rect")
    expect(handler).not.toContain("safeForRemote: true")
  })
})
