import type { CodeDisplayView, DiffDisplayView } from "./view-model"

export type SessionCodeRendererProps = {
  display: CodeDisplayView
  syntaxStyle?: unknown
  fg?: unknown
  conceal?: boolean
  drawUnstyledText?: boolean
  streaming?: boolean
}

export type SessionDiffRendererProps = {
  diff?: string
  display: DiffDisplayView
  syntaxStyle?: unknown
  colors: {
    fg: unknown
    addedBg: unknown
    removedBg: unknown
    contextBg: unknown
    addedSignColor: unknown
    removedSignColor: unknown
    lineNumberFg: unknown
    lineNumberBg: unknown
    addedLineNumberBg: unknown
    removedLineNumberBg: unknown
  }
}

export function SessionCodeRenderer(props: SessionCodeRendererProps) {
  return (
    <code
      filetype={props.display.filetype}
      // Paint the plain buffer until the async tree-sitter highlight resolves
      // (the framework default). `false` left `_shouldRenderTextBuffer` false
      // while the worker ran, so a finished reply painted nothing and came back
      // with different wrapping — the block visibly blinked at finalize.
      // Kimi Code keeps the cheap version visible the same way: transient plain
      // text, one highlight at the end.
      drawUnstyledText={props.drawUnstyledText ?? true}
      streaming={props.streaming}
      syntaxStyle={props.syntaxStyle as any}
      content={props.display.content}
      conceal={props.conceal}
      fg={props.fg as any}
    />
  )
}

export function SessionDiffRenderer(props: SessionDiffRendererProps) {
  return (
    <diff
      diff={props.diff}
      view={props.display.view}
      filetype={props.display.filetype}
      syntaxStyle={props.syntaxStyle as any}
      showLineNumbers={true}
      width="100%"
      wrapMode={props.display.wrapMode}
      fg={props.colors.fg as any}
      addedBg={props.colors.addedBg as any}
      removedBg={props.colors.removedBg as any}
      contextBg={props.colors.contextBg as any}
      addedSignColor={props.colors.addedSignColor as any}
      removedSignColor={props.colors.removedSignColor as any}
      lineNumberFg={props.colors.lineNumberFg as any}
      lineNumberBg={props.colors.lineNumberBg as any}
      addedLineNumberBg={props.colors.addedLineNumberBg as any}
      removedLineNumberBg={props.colors.removedLineNumberBg as any}
    />
  )
}
