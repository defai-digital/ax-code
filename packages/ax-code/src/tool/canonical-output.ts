import z from "zod"

/** Additive data contracts; the existing rendered output remains the native-tool presentation. */
export namespace CanonicalOutput {
  export const Glob = z.object({ paths: z.array(z.string()).max(100), truncated: z.boolean() }).strict()
  export const Grep = z
    .object({
      matches: z
        .array(z.object({ path: z.string(), line: z.number().int().nonnegative(), text: z.string() }).strict())
        .max(100),
      truncated: z.boolean(),
    })
    .strict()
  export const Read = z
    .object({ kind: z.enum(["text", "directory", "media"]), text: z.string(), truncated: z.boolean() })
    .strict()
}
