import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"

import { CanvasPanel } from "./CanvasPanel"

describe("CanvasPanel", () => {
  test("keeps canvas editing controls disabled until the document has loaded", () => {
    const markup = renderToStaticMarkup(<CanvasPanel directory="/workspace/project" />)

    expect(markup).toContain("Loading canvas")
    expect(markup).not.toContain("Start a project canvas")
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*Note/)
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*Image slot/)
  })
})
