import { toErrorMessage } from "./error-message"
import { Process } from "./process"

export interface GitResult {
  exitCode: number
  text(): string
  stdout: Buffer
  stderr: Buffer
}

// Transient failures where git could not acquire a lock and therefore never
// mutated anything — safe to retry for both reads and writes, since the command
// aborted before doing work. Concurrent worktree operations (e.g. removing one
// worktree while another's bootstrap runs `git worktree add`) hit these.
const LOCK_CONTENTION = /(index\.lock|\.lock': File exists|cannot lock ref|another git process|Unable to create)/i

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Run a git command.
 *
 * Uses Process helpers with stdin ignored to avoid protocol pipe inheritance
 * issues in embedded/client environments. Transient lock-contention failures
 * are retried with a short backoff so concurrent git operations don't surface
 * as spurious errors.
 */
export async function git(args: string[], opts: { cwd: string; env?: Record<string, string> }): Promise<GitResult> {
  const run = () =>
    Process.run(["git", ...args], {
      cwd: opts.cwd,
      env: opts.env,
      stdin: "ignore",
      nothrow: true,
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
    attempt < 5 && result.exitCode !== 0 && LOCK_CONTENTION.test(result.stderr.toString());
    attempt++
  ) {
    await sleep(50 * (attempt + 1))
    result = await run()
  }
  return result
}
