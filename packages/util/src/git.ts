import { toErrorMessage } from "./error-message"
import { sleep } from "./timeout"

export interface GitResult {
  exitCode: number
  text(): string
  stdout: Buffer
  stderr: Buffer
}

type GitOptions = { cwd: string; env?: Record<string, string>; timeout?: number }
type GitRunner = (args: string[], opts: GitOptions) => Promise<GitResult>
type GitProcess = {
  run(
    command: string[],
    opts: GitOptions & { stdin: "ignore"; nothrow: true },
  ): Promise<{ code: number; stdout: Buffer; stderr: Buffer }>
}

// Transient failures where git could not acquire a lock and therefore never
// mutated anything — safe to retry for both reads and writes, since the command
// aborted before doing work. Concurrent worktree operations (e.g. removing one
// worktree while another's bootstrap runs `git worktree add`) hit these.
const LOCK_CONTENTION = /(index\.lock|\.lock': File exists|cannot lock ref|another git process|Unable to create)/i

const MAX_LOCK_RETRIES = 5
const LOCK_RETRY_DELAY_MS = 50

/** Bind shared Git result handling and bounded retries to a host-owned process runner. */
export function createGit(runner: GitProcess): GitRunner {
  return async (args, opts) => {
    const run = (): Promise<GitResult> =>
      runner
        .run(["git", ...args], {
          cwd: opts.cwd,
          env: opts.env,
          stdin: "ignore",
          nothrow: true,
          timeout: opts.timeout,
        })
        .then((result) => ({
          exitCode: result.code,
          text: () => result.stdout.toString(),
          stdout: result.stdout,
          stderr: result.stderr,
        }))
        .catch((error) => ({
          exitCode: 1,
          text: () => "",
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(toErrorMessage(error)),
        }))

    let result = await run()
    for (
      let attempt = 0;
      attempt < MAX_LOCK_RETRIES && result.exitCode !== 0 && LOCK_CONTENTION.test(result.stderr.toString());
      attempt++
    ) {
      await sleep(LOCK_RETRY_DELAY_MS * (attempt + 1))
      result = await run()
    }
    return result
  }
}
