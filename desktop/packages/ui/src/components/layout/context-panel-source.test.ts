import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

const sourcePath = path.resolve(__dirname, "ContextPanel-impl.tsx")

describe("ContextPanel browser source guards", () => {
  test("desktop browser navigation updates React state before webview load events", async () => {
    const source = await readFile(sourcePath, "utf8")

    expect(source).toContain("setCurrentUrl(visibleUrl)")
    expect(source).toContain("setUrlInput(visibleUrl)")
    expect(source).toContain("setIsLoading(Boolean(visibleUrl))")
    expect(source).toContain('src={currentUrl || "about:blank"}')
  })
})
