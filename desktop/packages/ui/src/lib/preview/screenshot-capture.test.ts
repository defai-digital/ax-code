import { describe, expect, test } from "vitest"

import {
  formatPreviewAnnotationMarkdown,
  isPreviewElementMetadata,
  type PreviewElementMetadata,
} from "./screenshot-capture"

const createMetadata = (overrides: Partial<PreviewElementMetadata> = {}): PreviewElementMetadata => ({
  frame: "top",
  tag: "button",
  text: "Save",
  selector: "button.save",
  path: "html > body > button.save",
  bounds: { x: 10, y: 20, width: 80, height: 32 },
  center: { x: 50, y: 36 },
  attributes: { type: "button" },
  computedStyle: {
    display: "inline-flex",
    position: "static",
    fontWeight: "600",
    fontSize: "14px",
    lineHeight: "20px",
    fontFamily: "Inter",
    color: "rgb(0, 0, 0)",
    backgroundColor: "rgb(255, 255, 255)",
    zIndex: "auto",
  },
  ancestry: [
    {
      tag: "body",
      selectorPart: "body",
    },
    {
      tag: "button",
      className: "save",
      selectorPart: "button.save",
    },
  ],
  ...overrides,
})

describe("preview screenshot metadata", () => {
  test("accepts metadata that the annotation formatter can safely dereference", () => {
    const metadata = createMetadata()

    expect(isPreviewElementMetadata(metadata)).toBe(true)
    expect(
      formatPreviewAnnotationMarkdown({
        pageUrl: "http://localhost:3000/",
        viewport: { width: 1024, height: 768 },
        devicePixelRatio: 2,
        target: metadata,
        screenshotAttached: true,
        intro: "Inspect this element.",
      }),
    ).toContain("- Ancestry: body > button.save")
  })

  test("rejects malformed ancestry entries before the formatter can throw", () => {
    expect(
      isPreviewElementMetadata({
        ...createMetadata(),
        ancestry: [null],
      }),
    ).toBe(false)

    expect(
      isPreviewElementMetadata({
        ...createMetadata(),
        ancestry: [{ tag: "button" }],
      }),
    ).toBe(false)
  })
})
