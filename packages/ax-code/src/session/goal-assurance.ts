import path from "node:path"
import z from "zod"
import { VerificationPolicy } from "./verification-policy"

export namespace GoalAssurance {
  const Text = z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .refine((value) => !/[\r\n\0]/.test(value), "Use a single line")
  const SourcePath = Text.refine(
    (value) =>
      !path.posix.isAbsolute(value) &&
      !path.win32.isAbsolute(value) &&
      !value.split(/[\\/]/).some((part) => part === ".." || part === ".git") &&
      !value.replaceAll("\\", "/").replace(/^\.\//, "").startsWith(".ax-code/goals"),
    "Source paths must stay inside the workspace",
  )
  export const Schema = z
    .object({
      version: z.literal(1),
      sourcePaths: z.array(SourcePath).min(1).max(20),
      sources: z
        .array(
          z
            .object({
              reference: Text,
              role: z.enum(["legacy", "requirement", "implementation"]),
            })
            .strict(),
        )
        .max(12),
      checks: z
        .array(
          z
            .object({
              id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/),
              acceptanceIds: z
                .array(z.string().regex(/^AC\d+$/))
                .min(1)
                .max(5),
              command: Text.refine(
                (value) => !VerificationPolicy.isTrivialVerificationCommand(value),
                "A goal check must execute assertions, not an observation or no-op command",
              ),
              purpose: Text,
              environment: Text,
            })
            .strict(),
        )
        .min(1)
        .max(12),
    })
    .strict()

  export type Contract = z.infer<typeof Schema>
  export type Check = Contract["checks"][number]

  export function validate(value: unknown, acceptanceIds: readonly string[]): Contract {
    const contract = Schema.parse(value)
    const ids = new Set<string>()
    const covered = new Set<string>()
    for (const check of contract.checks) {
      if (ids.has(check.id)) throw new Error(`Duplicate goal check id ${check.id}`)
      ids.add(check.id)
      if (new Set(check.acceptanceIds).size !== check.acceptanceIds.length) {
        throw new Error(`Duplicate acceptance coverage in goal check ${check.id}`)
      }
      for (const id of check.acceptanceIds) {
        if (!acceptanceIds.includes(id)) throw new Error(`Unknown acceptance id ${id} in goal check ${check.id}`)
        covered.add(id)
      }
    }
    const missing = acceptanceIds.filter((id) => !covered.has(id))
    if (missing.length) throw new Error(`Goal checks must cover every acceptance id; missing ${missing.join(", ")}`)
    return contract
  }
}
