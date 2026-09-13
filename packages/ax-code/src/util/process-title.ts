/**
 * Machine process title, shared by every entry point.
 *
 * Set on Linux and Windows at each entry (before the compat shims and the
 * dynamic CLI import) so process-name-derived surfaces — `ps`, tmux
 * automatic-rename, terminal tab lists — show "ax-code" within milliseconds
 * of exec instead of staying "node" while the CLI module graph loads. The
 * assignments in cli/boot.ts and cli/boot-node.ts previously ran only after
 * that import finished.
 *
 * Keep this the lowercase machine name: the Linux comm field truncates to 15
 * characters, pgrep/pm2-style tooling matches lowercase, and on Windows
 * process.title also drives SetConsoleTitle. The user-facing "AX-Code"
 * casing belongs to the OSC terminal title (util/terminal-title.ts).
 *
 * On macOS, preserve argv: libuv clears its storage when setting process.title,
 * but KERN_PROCARGS2 still reports the original argc. Terminal's job-title
 * reader can then consume environment entries as missing arguments, producing
 * a long title when it refreshes an inactive tab. The source and packaged
 * launchers instead brand the Node executable as "AX-Code", keep the process
 * argv short ("AX-Code /dev/null [user args]") by moving the Node flags and
 * the entry into NODE_OPTIONS, and OSC titles provide the user-facing label
 * without rewriting process arguments.
 */
export const AX_CODE_PROCESS_TITLE = "ax-code"

export function setAxCodeProcessTitle(runtime: Pick<NodeJS.Process, "platform" | "title"> = process): void {
  if (runtime.platform === "darwin") return
  try {
    runtime.title = AX_CODE_PROCESS_TITLE
  } catch {
    // Some embedded runtimes reject title writes; never block boot.
  }
}
