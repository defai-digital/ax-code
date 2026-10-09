import z from "zod"
import { toErrorMessage } from "../util/error-message"
import { parseJsonResult } from "../util/json-value"

const PrViewSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  baseRefName: z.string(),
  headRefName: z.string(),
  headRefOid: z.string(),
})
type PrView = z.infer<typeof PrViewSchema>

export type PrViewDecodeResult =
  | {
      ok: true
      data: PrView
    }
  | {
      ok: false
      error: string
    }

export function decodePrViewValue(value: unknown): PrViewDecodeResult {
  const decoded = PrViewSchema.safeParse(value)
  return decoded.success ? { ok: true, data: decoded.data } : { ok: false, error: decoded.error.message }
}

export function decodePrViewJson(stdout: string): PrViewDecodeResult {
  const parsed = parseJsonResult(stdout)
  if (!parsed.ok) {
    const { error } = parsed
    return { ok: false, error: toErrorMessage(error) }
  }
  return decodePrViewValue(parsed.value)
}
