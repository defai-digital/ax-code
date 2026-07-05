import { describe, expect, it } from "vitest"

import {
  formatNotificationModeLabel,
  formatNotificationModelLabel,
  formatNotificationProjectLabel,
} from "./label-format.js"

describe("notification label formatting", () => {
  it("trims and title-cases project and mode labels", () => {
    expect(formatNotificationProjectLabel(" work_app ")).toBe("Work App")
    expect(formatNotificationModeLabel(" debug agent ")).toBe("Debug Agent")
  })

  it("formats model labels and preserves empty fallback", () => {
    expect(formatNotificationModelLabel(" glm-5-1-air ")).toBe("Glm 5.1 Air")
    expect(formatNotificationModelLabel("   ")).toBe("Assistant")
  })
})
