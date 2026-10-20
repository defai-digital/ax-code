import { expect, test } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { createTranscriptProjector } from "../../../../src/cli/tui/inline/transcript-projector"
import type { Message, Part } from "@ax-code/sdk/v2"

test("inline owned components mount no pixel, sixel, Kitty image, or digital-code renderer", () => {
  const root = path.resolve(import.meta.dirname, "../../../../src/cli/tui/inline")
  for (const name of fs.readdirSync(root).filter((name) => /\.tsx?$/.test(name))) {
    const source = fs.readFileSync(path.join(root, name), "utf8")
    expect(source).not.toMatch(/<(?:DigitalCode|Sixel\w*|Kitty\w*|Pixel\w*|ImagePreview)\b/)
    expect(source).not.toMatch(/from ["'][^"']*(?:digital-code|sixel|image-preview|pixels)["']/)
  }
  const projector = createTranscriptProjector()
  const blocks = projector.project({
    sessionID: "s",
    messages: [{ id: "m", role: "assistant" } as Message],
    parts: {
      m: [
        {
          id: "p",
          type: "file",
          mime: "image/png",
          filename: "diagram.png",
          url: "data:image/png;base64,secret",
        } as Part,
      ],
    },
  })
  expect(blocks.at(-1)?.text).toBe("[image: diagram.png]")
  expect(blocks.map((block) => block.text).join("\n")).not.toContain("secret")
})
