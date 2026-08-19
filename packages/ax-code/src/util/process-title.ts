/**
 * Machine process title, shared by every entry point.
 *
 * Set as the first statement of each entry (before the compat shims and the
 * dynamic CLI import) so process-name-derived surfaces — `ps`, tmux
 * automatic-rename, terminal tab lists — show "ax-code" within milliseconds
 * of exec instead of staying "node" while the CLI module graph loads. The
 * assignments in cli/boot.ts and cli/boot-node.ts previously ran only after
 * that import finished.
 *
 * Keep this the lowercase machine name: the Linux comm field truncates to 15
 * characters, pgrep/pm2-style tooling matches lowercase, and on Windows
 * process.title also drives SetConsoleTitle. The user-facing "AX-Code"
 * casing belongs to the TUI's OSC terminal titles (cmd/tui/renderer.ts), and
 * the OS-level executable name is branded by the node-bundled launcher
 * (script/build-node-tui.ts hardlinks node as "ax-code").
 */
export const AX_CODE_PROCESS_TITLE = "ax-code"

export function setAxCodeProcessTitle(): void {
  try {
    process.title = AX_CODE_PROCESS_TITLE
  } catch {
    // Some embedded runtimes reject title writes; never block boot.
  }
}
