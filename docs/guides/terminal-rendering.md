# Terminal rendering

Status: Current
Scope: TUI terminal profile selection, overrides, and visual capability boundaries
Last reviewed: 2026-09-16
Owner: AX Code TUI maintainers

AX Code chooses a terminal profile from the environment when it starts. The
profile controls terminal setup, not monitor resolution or font sharpness.

| Terminal environment                                  | Automatic profile | Identification                                                                                      |
| ----------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| Windows Terminal, including Ubuntu in WSL             | Advanced          | Nonempty `WT_SESSION`, with no conflicting `TERM_PROGRAM`                                           |
| GNOME Terminal and other VTE hosts                    | Advanced          | Positive decimal `VTE_VERSION`, `TERM=xterm` or `xterm-256color`, and no conflicting `TERM_PROGRAM` |
| Ghostty                                               | Advanced          | `TERM_PROGRAM=ghostty` or `TERM=xterm-ghostty`                                                      |
| macOS Terminal.app                                    | Compatible        | `TERM_PROGRAM=Apple_Terminal`                                                                       |
| Unknown terminals, SSH/mosh, tmux, screen, and Zellij | Compatible        | Conservative fallback                                                                               |

An explicit `TERM_PROGRAM` takes precedence over inherited outer-terminal
markers. Limited terminal types such as `dumb`, `linux`, and `vt100` also stay
compatible. Ubuntu or WSL identity alone does not enable the advanced profile.

The advanced profile uses the alternate screen, a native rendering thread, and
terminal capability detection. The compatible profile uses the main screen
without the native rendering thread. Both enable mouse interaction and keyboard
protocol negotiation and target 60 FPS; actual frame rates depend on the workload
and terminal.

Windows Terminal keeps 24-bit visual effects in either profile when its direct
session is identified. Color support does not imply pixel graphics or Nerd Font
support. Advanced mode does not change the font, font size, or display scaling.

## Override the profile

Set `AX_CODE_TUI_ADVANCED_TERMINAL=1` to request advanced mode or `0` to request
compatible mode. An explicit override takes priority over automatic detection,
including remote and multiplexed sessions. Remove the variable to restore
automatic selection. `true`/`false`, `yes`/`no`, and `on`/`off` are also accepted.

PowerShell, for the current shell and its child processes:

```powershell
$env:AX_CODE_TUI_ADVANCED_TERMINAL = "1"
ax-code

# Use compatible mode if startup or rendering has problems.
$env:AX_CODE_TUI_ADVANCED_TERMINAL = "0"
ax-code

# Restore automatic selection.
Remove-Item Env:AX_CODE_TUI_ADVANCED_TERMINAL -ErrorAction SilentlyContinue
```

Bash or Zsh, for a single launch:

```sh
AX_CODE_TUI_ADVANCED_TERMINAL=1 ax-code
AX_CODE_TUI_ADVANCED_TERMINAL=0 ax-code
```

If your shell startup files export the variable, remove that export and run
`unset AX_CODE_TUI_ADVANCED_TERMINAL` to restore automatic selection.

## Pixel animations

Opening and ending animations use pixels only when the renderer confirms Kitty
graphics, valid pixel dimensions, a local TTY, the alternate screen, and no
multiplexer. Missing capabilities or a graphics failure use the text fallback.
Automatic advanced mode does not bypass these checks.

Digital Code and Foliage pixel frames are bounded to 1280x720; Fuji Mountain,
Bench, and Mahjong are bounded to 1920x1080. These animation frames update on a
20 FPS schedule, separately from the renderer's 60 FPS target.
See [TUI opening and ending animations](tui-animations.md) for previews.
