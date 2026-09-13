/**
 * Restore the caller's NODE_OPTIONS after a POSIX TUI launcher prepended the
 * boot chain (--experimental-ffi and the --import sequence that loads this
 * entry). Launchers do that so the process argv stays "AX-Code /dev/null …" —
 * Apple Terminal composes inactive-tab job titles from the full KERN_PROCARGS2
 * argv, and the long Node flag/entry list otherwise replaces the short product
 * tab title. The launcher saves the pre-launch value in
 * AX_CODE_LAUNCH_NODE_OPTIONS (set but empty when NODE_OPTIONS was unset).
 *
 * The restore must run before the CLI module graph loads: any Node child
 * spawned with the augmented NODE_OPTIONS would re-import the whole CLI.
 */

export const AX_CODE_LAUNCH_NODE_OPTIONS = "AX_CODE_LAUNCH_NODE_OPTIONS"

export function restoreAxCodeLaunchNodeOptions(env: NodeJS.ProcessEnv = process.env): boolean {
  const saved = env[AX_CODE_LAUNCH_NODE_OPTIONS]
  if (saved === undefined) return false
  if (saved.length === 0) delete env["NODE_OPTIONS"]
  else env["NODE_OPTIONS"] = saved
  delete env[AX_CODE_LAUNCH_NODE_OPTIONS]
  return true
}
