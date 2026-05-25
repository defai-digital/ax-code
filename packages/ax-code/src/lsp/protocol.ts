import z from "zod"

export const Range = z
  .object({
    start: z.object({
      line: z.number(),
      character: z.number(),
    }),
    end: z.object({
      line: z.number(),
      character: z.number(),
    }),
  })
  .meta({
    ref: "Range",
  })
export type Range = z.infer<typeof Range>

export const Symbol = z
  .object({
    name: z.string(),
    kind: z.number(),
    location: z.object({
      uri: z.string(),
      range: Range,
    }),
  })
  .meta({
    ref: "Symbol",
  })
export type Symbol = z.infer<typeof Symbol>

export const DocumentSymbol = z
  .object({
    name: z.string(),
    detail: z.string().optional(),
    kind: z.number(),
    range: Range,
    selectionRange: Range,
  })
  .meta({
    ref: "DocumentSymbol",
  })
export type DocumentSymbol = z.infer<typeof DocumentSymbol>
