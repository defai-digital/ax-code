import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import stripAnsi from "strip-ansi"
import { BashTool } from "@/tool/bash"
import type { WriteTool } from "@/tool/write"
import type { EditTool } from "@/tool/edit"
import type { ApplyPatchTool } from "@/tool/apply_patch"
import { Global } from "@/global"
import { Locale } from "@/util/locale"
import { detail, diagnostics, diffSummary, normalize, workdir } from "../format"
import { codeDisplayView, diffDisplayView } from "../view-model"
import { SessionCodeRenderer, SessionDiffRenderer } from "../render-adapter"
import { useSessionRouteContext } from "../context"
import { BlockTool, InlineTool, type ToolProps } from "./primitives"

export function Bash(props: ToolProps<typeof BashTool>) {
  const { theme } = useTheme()
  const sync = useSync()
  const isRunning = createMemo(() => props.part.state.status === "running")
  const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => output().split("\n"))
  const overflow = createMemo(() => lines().length > 10)
  const limited = createMemo(() => {
    if (expanded() || !overflow()) return output()
    return [...lines().slice(0, 10), "…"].join("\n")
  })

  const workdirDisplay = createMemo(() => {
    return workdir(sync.data.path.directory, Global.Path.home, props.input.workdir)
  })

  const title = createMemo(() => {
    const desc = props.input.description ?? "Shell"
    const wd = workdirDisplay()
    if (!wd) return `# ${desc}`
    if (desc.includes(wd)) return `# ${desc}`
    return `# ${desc} in ${wd}`
  })

  return (
    <Switch>
      <Match when={props.metadata.output !== undefined}>
        <BlockTool
          title={title()}
          part={props.part}
          spinner={isRunning()}
          onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
        >
          <box gap={1}>
            <text fg={theme.text}>$ {props.input.command}</text>
            <Show when={output()}>
              <text fg={theme.text}>{limited()}</text>
            </Show>
            <Show when={overflow()}>
              <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="$" pending="Writing command..." complete={props.input.command} part={props.part}>
          {props.input.command}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function Write(props: ToolProps<typeof WriteTool>) {
  const { theme, syntax } = useTheme()
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => (props.input.content ?? "").split("\n"))
  const overflow = createMemo(() => lines().length > 20)
  const visibleContent = createMemo(() => {
    if (expanded() || !overflow()) return props.input.content
    return lines().slice(0, 20).join("\n") + "\n…"
  })
  const display = createMemo(() => codeDisplayView({ filePath: props.input.filePath, content: visibleContent() }))

  return (
    <Switch>
      <Match when={props.metadata.diagnostics !== undefined}>
        <BlockTool
          title={"# Wrote " + normalize(props.input.filePath)}
          part={props.part}
          onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
        >
          <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
            <SessionCodeRenderer display={display()} conceal={false} fg={theme.text} syntaxStyle={syntax()} />
          </line_number>
          <Show when={overflow()}>
            <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
          </Show>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={props.input.filePath ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing write..." complete={props.input.filePath} part={props.part}>
          Write {normalize(props.input.filePath)}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function Edit(props: ToolProps<typeof EditTool>) {
  const ctx = useSessionRouteContext()
  const { theme, syntax } = useTheme()
  const [expanded, setExpanded] = createSignal(false)

  const view = createMemo(() => {
    return diffDisplayView({
      diffStyle: ctx.tui.diff_style,
      width: ctx.width,
      filePath: props.input.filePath,
      wrapMode: ctx.diffWrapMode(),
    })
  })

  const rawDiff = createMemo(() => props.metadata.diff ?? "")
  const diffLines = createMemo(() => rawDiff().split("\n"))
  const overflow = createMemo(() => diffLines().length > 30)
  const diffContent = createMemo(() => {
    if (expanded() || !overflow()) return rawDiff()
    return diffLines().slice(0, 30).join("\n") + "\n…"
  })
  const summary = createMemo(() => diffSummary(rawDiff()))

  return (
    <Switch>
      <Match when={props.metadata.diff !== undefined}>
        <BlockTool
          title={"← Edit " + normalize(props.input.filePath)}
          part={props.part}
          onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
        >
          <Show when={summary()}>
            {(s) => (
              <text paddingLeft={1} fg={theme.textMuted}>
                {s().hunks} {s().hunks === 1 ? "hunk" : "hunks"} ·{" "}
                <span style={{ fg: theme.success }}>+{s().added}</span>{" "}
                <span style={{ fg: theme.error }}>−{s().removed}</span>
              </text>
            )}
          </Show>
          <box paddingLeft={1}>
            <SessionDiffRenderer
              diff={diffContent()}
              display={view()}
              syntaxStyle={syntax()}
              colors={{
                fg: theme.text,
                addedBg: theme.diffAddedBg,
                removedBg: theme.diffRemovedBg,
                contextBg: theme.diffContextBg,
                addedSignColor: theme.diffHighlightAdded,
                removedSignColor: theme.diffHighlightRemoved,
                lineNumberFg: theme.diffLineNumber,
                lineNumberBg: theme.diffContextBg,
                addedLineNumberBg: theme.diffAddedLineNumberBg,
                removedLineNumberBg: theme.diffRemovedLineNumberBg,
              }}
            />
          </box>
          <Show when={overflow()}>
            <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
          </Show>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={props.input.filePath ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing edit..." complete={props.input.filePath} part={props.part}>
          Edit {normalize(props.input.filePath)} {detail({ replaceAll: props.input.replaceAll })}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function ApplyPatch(props: ToolProps<typeof ApplyPatchTool>) {
  const ctx = useSessionRouteContext()
  const { theme, syntax } = useTheme()

  const files = createMemo(() => props.metadata.files ?? [])

  const view = createMemo(() => {
    return (filePath: string) =>
      diffDisplayView({
        diffStyle: ctx.tui.diff_style,
        width: ctx.width,
        filePath,
        wrapMode: ctx.diffWrapMode(),
      })
  })

  function Diff(p: { diff: string; filePath: string }) {
    return (
      <box paddingLeft={1}>
        <SessionDiffRenderer
          diff={p.diff}
          display={view()(p.filePath)}
          syntaxStyle={syntax()}
          colors={{
            fg: theme.text,
            addedBg: theme.diffAddedBg,
            removedBg: theme.diffRemovedBg,
            contextBg: theme.diffContextBg,
            addedSignColor: theme.diffHighlightAdded,
            removedSignColor: theme.diffHighlightRemoved,
            lineNumberFg: theme.diffLineNumber,
            lineNumberBg: theme.diffContextBg,
            addedLineNumberBg: theme.diffAddedLineNumberBg,
            removedLineNumberBg: theme.diffRemovedLineNumberBg,
          }}
        />
      </box>
    )
  }

  function title(file: { type: string; relativePath: string; filePath: string; deletions: number }) {
    if (file.type === "delete") return "# Deleted " + file.relativePath
    if (file.type === "add") return "# Created " + file.relativePath
    if (file.type === "move") return "# Moved " + normalize(file.filePath) + " → " + file.relativePath
    return "← Patched " + file.relativePath
  }

  return (
    <Switch>
      <Match when={files().length > 0}>
        <For each={files()}>
          {(file) => {
            const fileSummary = createMemo(() => diffSummary(file.diff))
            return (
              <BlockTool title={title(file)} part={props.part}>
                <Show
                  when={file.type !== "delete"}
                  fallback={
                    <text fg={theme.diffRemoved}>- {Locale.pluralize(file.deletions, "{} line", "{} lines")}</text>
                  }
                >
                  <Show when={fileSummary()}>
                    {(s) => (
                      <text paddingLeft={1} fg={theme.textMuted}>
                        {s().hunks} {s().hunks === 1 ? "hunk" : "hunks"} ·{" "}
                        <span style={{ fg: theme.success }}>+{s().added}</span>{" "}
                        <span style={{ fg: theme.error }}>−{s().removed}</span>
                      </text>
                    )}
                  </Show>
                  <Diff diff={file.diff} filePath={file.filePath} />
                  <Diagnostics diagnostics={props.metadata.diagnostics} filePath={file.movePath ?? file.filePath} />
                </Show>
              </BlockTool>
            )
          }}
        </For>
      </Match>
      <Match when={true}>
        <InlineTool icon="%" pending="Preparing patch..." complete={false} part={props.part}>
          Patch
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Diagnostics(props: { diagnostics?: Record<string, Record<string, any>[]>; filePath: string }) {
  const { theme } = useTheme()
  const errors = createMemo(() => diagnostics(props.diagnostics, props.filePath))

  return (
    <Show when={errors().length}>
      <box>
        <For each={errors()}>
          {(diagnostic) => (
            <text fg={theme.error}>
              Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}] {diagnostic.message}
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}
