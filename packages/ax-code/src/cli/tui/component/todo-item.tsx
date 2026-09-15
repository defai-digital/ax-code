import { useTheme } from "../context/theme"
import { Todo } from "@/session/todo"

export interface TodoItemProps {
  status: string
  content: string
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()
  const isInProgress = props.status === "in_progress"

  return (
    <box flexDirection="row" gap={0}>
      <text
        flexShrink={0}
        style={{
          fg: isInProgress ? theme.warning : theme.textMuted,
        }}
      >
        [{Todo.checkboxMarker(props.status, "unicode")}]{" "}
      </text>
      <text
        flexGrow={1}
        wrapMode="word"
        style={{
          fg: isInProgress ? theme.warning : theme.textMuted,
        }}
      >
        {props.content}
      </text>
    </box>
  )
}
