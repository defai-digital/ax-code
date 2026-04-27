export type TuiRendererContractGate = "automated" | "manual" | "adr"

export type TuiRendererContractRequirement = {
  id: string
  area: "frame" | "input" | "focus" | "scroll" | "text" | "prompt" | "dialog" | "debug" | "extension" | "packaging"
  requirement: string
  gate: TuiRendererContractGate
}

export const TUI_RENDERER_CONTRACT_VERSION = "2026-04-13"

export const TUI_RENDERER_CONTRACT: TuiRendererContractRequirement[] = [
  {
    id: "frame.lifecycle",
    area: "frame",
    requirement: "Renderer starts, paints a non-empty first frame, handles terminal resize, and shuts down cleanly.",
    gate: "automated",
  },
  {
    id: "input.keyboard-mouse-paste-selection",
    area: "input",
    requirement:
      "Keyboard, paired mouse down/up, bracketed paste, and selection/copy events route to the active surface.",
    gate: "automated",
  },
  {
    id: "focus.modal-ownership",
    area: "focus",
    requirement: "Dialogs, permission prompts, provider selector, and command palette own focus until dismissed.",
    gate: "automated",
  },
  {
    id: "scroll.viewport",
    area: "scroll",
    requirement:
      "Long transcript scroll state stays stable across append, resize, next/previous navigation, and CJK wrapping.",
    gate: "automated",
  },
  {
    id: "text.cjk-ansi-long-lines",
    area: "text",
    requirement:
      "CJK width, ANSI styling, code blocks, diffs, and long unbroken lines render without corrupting layout.",
    gate: "manual",
  },
  {
    id: "prompt.autocomplete",
    area: "prompt",
    requirement:
      "Prompt editing, history, autocomplete, paste, external editor, and async submit preserve input state.",
    gate: "automated",
  },
  {
    id: "dialog.command-provider-permission",
    area: "dialog",
    requirement:
      "Command, provider, permission, confirmation, and alert dialogs preserve keyboard and mouse semantics.",
    gate: "automated",
  },
  {
    id: "debug.crash-reporting",
    area: "debug",
    requirement: "Debug mode records renderer actions, task transitions, fatal errors, and crash diagnostics locally.",
    gate: "automated",
  },
  {
    id: "extension.plugin-slots",
    area: "extension",
    requirement:
      "Plugin UI slots can project bounded header, sidebar, transcript, and footer content without blocking input.",
    gate: "adr",
  },
  {
    id: "packaging.enterprise-offline",
    area: "packaging",
    requirement: "Enterprise builds remain deterministic and offline-capable with no runtime renderer downloads.",
    gate: "adr",
  },
]

export const TUI_RENDERER_CONTRACT_REQUIRED_AREAS = [
  "frame",
  "input",
  "focus",
  "scroll",
  "text",
  "prompt",
  "dialog",
  "debug",
  "extension",
  "packaging",
] as const
