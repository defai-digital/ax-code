import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./browser-snapshot.txt"
import { BrowserRuntime } from "./runtime"

export const BrowserSnapshotTool = Tool.define("browser_snapshot", {
  description: DESCRIPTION,
  parameters: z.object({
    verbose: z
      .boolean()
      .default(false)
      .describe("Include additional element details (computed styles, bounding boxes)"),
  }),
  async execute(params, ctx) {
    const runtime = BrowserRuntime.get()
    // Use the most recently opened page
    const snapshot = await runtime.snapshot("latest", params.verbose)

    return {
      title: "Page snapshot",
      output: snapshot.text,
      metadata: {
        pageID: snapshot.pageID,
        elementCount: snapshot.elements.length,
      },
    }
  },
})
