import { createMemo, For, Match, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import type { ReadTool } from "@/tool/read"
import { TodoWriteTool } from "@/tool/todo"
import type { QuestionTool } from "@/tool/question"
import { Locale } from "@/util/locale"
import { TodoItem } from "../../../component/todo-item"
import { detail, normalize } from "../format"
import { todoWriteView } from "../view-model"
import { BlockTool, InlineTool, type ToolProps } from "./primitives"

export function Read(props: ToolProps<typeof ReadTool>) {
  const { theme } = useTheme()
  const isRunning = createMemo(() => props.part.state.status === "running")
  const loaded = createMemo(() => {
    if (props.part.state.status !== "completed") return []
    if (props.part.state.time.compacted) return []
    const value = props.metadata.loaded
    if (!value || !Array.isArray(value)) return []
    return value.filter((p): p is string => typeof p === "string")
  })
  return (
    <>
      <InlineTool
        icon="→"
        pending="Reading file..."
        complete={props.input.filePath}
        spinner={isRunning()}
        part={props.part}
      >
        Read {normalize(props.input.filePath)} {detail(props.input, ["filePath"])}
      </InlineTool>
      <For each={loaded()}>
        {(filepath) => (
          <box paddingLeft={3}>
            <text paddingLeft={3} fg={theme.textMuted}>
              ↳ Loaded {normalize(filepath)}
            </text>
          </box>
        )}
      </For>
    </>
  )
}

export function TodoWrite(props: ToolProps<typeof TodoWriteTool>) {
  const view = createMemo(() =>
    todoWriteView({
      status: props.part.state.status,
      inputTodos: props.input.todos,
      metadataTodos: props.metadata.todos,
      output: props.output,
    }),
  )

  return (
    <Switch>
      <Match when={view().state === "items"}>
        <BlockTool title="# Todos" part={props.part}>
          <box>
            <For each={view().todos}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
          </box>
        </BlockTool>
      </Match>
      <Match when={view().state === "empty"}>
        <InlineTool icon="✓" pending="Updating todos..." complete={true} part={props.part}>
          No todos
        </InlineTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="⚙" pending="Updating todos..." complete={false} part={props.part}>
          Updating todos...
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function Question(props: ToolProps<typeof QuestionTool>) {
  const { theme } = useTheme()
  const count = createMemo(() => props.input.questions?.length ?? 0)

  function format(answer?: string[]) {
    if (!answer?.length) return "(no answer)"
    return answer.join(", ")
  }

  return (
    <Switch>
      <Match when={props.metadata.answers}>
        <BlockTool title="# Questions" part={props.part}>
          <box gap={1}>
            <For each={props.input.questions ?? []}>
              {(q, i) => (
                <box flexDirection="column">
                  <text fg={theme.textMuted}>{q.question}</text>
                  <text fg={theme.text}>{format(props.metadata.answers?.[i()])}</text>
                </box>
              )}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="→" pending="Asking questions..." complete={count()} part={props.part}>
          {Locale.pluralize(count(), "Asked {} question", "Asked {} questions")}
        </InlineTool>
      </Match>
    </Switch>
  )
}
