import z from "zod"
import { NamedError } from "@ax-code/util/error"
import { Env } from "../util/env"
import { Log } from "../util/log"

const log = Log.create({ service: "quality.pr-diff" })

export const GhMissingError = NamedError.create(
  "GhMissingError",
  z.object({
    hint: z.string(),
  }),
)

export const GhUnauthedError = NamedError.create(
  "GhUnauthedError",
  z.object({
    stderr: z.string(),
    hint: z.string(),
  }),
)

export const GhFetchError = NamedError.create(
  "GhFetchError",
  z.object({
    command: z.string(),
    exitCode: z.number(),
    stderr: z.string(),
  }),
)

export type PrDiff = {
  ref: string
  title: string
  baseRef: string
  headRef: string
  headSha: string
  diff: string
}

const DEFAULT_TIMEOUT_MS = 30_000

async function runGh(args: string[], cwd: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const proc = Bun.spawn(["gh", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: Env.sanitize(),
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, timeoutMs)
  const [code, stdout, stderr] = await Promise.all([
    proc.exited.finally(() => clearTimeout(timer)),
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { code, stdout, stderr, timedOut }
}

async function ensureGhAvailable(cwd: string): Promise<void> {
  try {
    const probe = await runGh(["--version"], cwd, 5_000)
    if (probe.code !== 0) {
      throw new GhMissingError({
        hint: "`gh --version` returned non-zero. Install GitHub CLI from https://cli.github.com/ or use a path that ships it.",
      })
    }
  } catch (e) {
    if (GhMissingError.isInstance(e)) throw e
    throw new GhMissingError({
      hint: "`gh` not found on PATH. Install GitHub CLI from https://cli.github.com/ before invoking review on a PR.",
    })
  }

  const auth = await runGh(["auth", "status"], cwd, 10_000)
  if (auth.code !== 0) {
    throw new GhUnauthedError({
      stderr: auth.stderr.trim(),
      hint: "Run `gh auth login` to authenticate the GitHub CLI; ax-code will not fall back to a direct API path in v4.x.x.",
    })
  }
}

const PrViewSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  baseRefName: z.string(),
  headRefName: z.string(),
  headRefOid: z.string(),
})

export async function fetchPrDiff(prRef: string, cwd: string): Promise<PrDiff> {
  await ensureGhAvailable(cwd)

  const view = await runGh(["pr", "view", prRef, "--json", "number,title,baseRefName,headRefName,headRefOid"], cwd)
  if (view.code !== 0) {
    throw new GhFetchError({
      command: `gh pr view ${prRef}`,
      exitCode: view.code,
      stderr: view.stderr.trim(),
    })
  }

  let parsed: z.infer<typeof PrViewSchema>
  try {
    parsed = PrViewSchema.parse(JSON.parse(view.stdout))
  } catch (err) {
    throw new GhFetchError({
      command: `gh pr view ${prRef}`,
      exitCode: 0,
      stderr: `gh returned 0 but the response did not match the expected shape: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  const diff = await runGh(["pr", "diff", prRef], cwd)
  if (diff.code !== 0) {
    throw new GhFetchError({
      command: `gh pr diff ${prRef}`,
      exitCode: diff.code,
      stderr: diff.stderr.trim(),
    })
  }

  log.info("fetched pr diff", { ref: prRef, baseRef: parsed.baseRefName, headSha: parsed.headRefOid })

  return {
    ref: String(parsed.number),
    title: parsed.title,
    baseRef: parsed.baseRefName,
    headRef: parsed.headRefName,
    headSha: parsed.headRefOid,
    diff: diff.stdout,
  }
}
