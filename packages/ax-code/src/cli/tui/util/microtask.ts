import { runTuiBackgroundTask, type TuiBackgroundTaskLogger } from "./background-task"

export function scheduleMicrotaskTask(
  task: () => void | Promise<void>,
  input: {
    name: string
    onError?: (error: unknown) => void
    logger?: TuiBackgroundTaskLogger
  },
) {
  return runTuiBackgroundTask(task, input)
}
