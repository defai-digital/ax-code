export const ACTIVE_TODO_STATUSES = new Set(["pending", "in_progress"])

export function isActiveTodoStatus(status: unknown): status is "pending" | "in_progress" {
  return typeof status === "string" && ACTIVE_TODO_STATUSES.has(status)
}

export function isActiveTodo<T extends { status?: unknown }>(
  todo: T,
): todo is T & { status: "pending" | "in_progress" } {
  return isActiveTodoStatus(todo.status)
}
