/**
 * Grounder fallback for computer use: resolves a natural-language target
 * description ("the Save button in the toolbar") to screenshot pixel
 * coordinates using a configured vision model (computer.grounder.model),
 * for cases where element-id targeting is unavailable (OCU elements carry no
 * bounds, element not in the tree).
 *
 * Coordinates only: the model's response is parsed for an {x, y} point and
 * clamped to the image bounds — generated content is NEVER executed.
 * The model call is injectable (GroundDeps) so tests never touch a provider.
 */
import { generateText } from "ai"
import type { PixelImage } from "@ax-code/computer"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { parseJsonResult } from "@/util/json-value"

export interface GroundPoint {
  x: number
  y: number
}

export interface GroundDeps {
  /** defaults to a generateText call on the configured grounder model */
  ask?: (input: { system: string; prompt: string; image: PixelImage }) => Promise<string>
}

const GROUND_SYSTEM = `You are a GUI grounding model. Given a screenshot and a natural-language description of a UI
element, output the pixel coordinates of the element's center as one JSON object: {"x": number, "y": number}.
Coordinates are in screenshot pixels, origin top-left. Output nothing else.`

let testDeps: GroundDeps | undefined

/** test-only: replace the grounder model call (undefined restores the real one) */
export function _setGroundDepsForTests(deps: GroundDeps | undefined): void {
  testDeps = deps
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

/**
 * Extract a point from a grounder response: the first JSON object with numeric
 * x/y, else the first "x, y" number pair. Clamped to the image bounds when
 * dimensions are known. Throws a clear error when nothing parses.
 */
export function parseGroundPoint(text: string, image: { width?: number; height?: number }): GroundPoint {
  let point: GroundPoint | undefined

  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start >= 0 && end > start) {
    const parsed = parseJsonResult(text.slice(start, end + 1))
    if (parsed.ok) {
      const value = parsed.value
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>
        if (isNumber(record.x) && isNumber(record.y)) point = { x: record.x, y: record.y }
      }
    }
  }

  if (!point) {
    const pair = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(text)
    if (pair) point = { x: Number(pair[1]), y: Number(pair[2]) }
  }

  if (!point) {
    throw new Error(`grounder response could not be parsed into coordinates: ${text.slice(0, 200)}`)
  }

  const x = Math.round(point.x)
  const y = Math.round(point.y)
  return {
    x: image.width !== undefined ? Math.min(Math.max(0, x), image.width - 1) : Math.max(0, x),
    y: image.height !== undefined ? Math.min(Math.max(0, y), image.height - 1) : Math.max(0, y),
  }
}

/** Resolve a natural-language target description to screenshot pixel coordinates. */
export async function ground(
  input: { image: PixelImage; description: string },
  deps?: GroundDeps,
): Promise<GroundPoint> {
  const ask = deps?.ask ?? testDeps?.ask ?? defaultAsk
  const { width, height } = input.image
  const prompt = [
    `Screenshot size: ${width ?? "unknown"}x${height ?? "unknown"} pixels.`,
    `Locate: ${input.description}`,
    'Respond with ONLY the JSON point of the element\'s center, e.g. {"x": 123, "y": 456}.',
  ].join("\n")
  const text = await ask({ system: GROUND_SYSTEM, prompt, image: input.image })
  return parseGroundPoint(text, input.image)
}

async function defaultAsk(input: { system: string; prompt: string; image: PixelImage }): Promise<string> {
  const grounder = (await Config.get()).computer?.grounder
  if (!grounder?.model) {
    throw new Error(
      "computer.grounder is not configured — set computer.grounder.model (provider/model) to enable natural-language targets",
    )
  }
  const reference = Provider.parseModel(grounder.model)
  const model = await Provider.getModel(reference.providerID, reference.modelID)
  const language = await Provider.getLanguage(model)
  const mime = input.image.mimeType || "image/png"
  const result = await generateText({
    model: language,
    maxOutputTokens: ProviderTransform.auxMaxOutputTokens(model),
    messages: [
      { role: "system", content: input.system },
      {
        role: "user",
        content: [
          { type: "text", text: input.prompt },
          { type: "image", image: `data:${mime};base64,${input.image.data}` },
        ],
      },
    ],
  })
  return result.text ?? ""
}
