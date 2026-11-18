import { once } from "node:events"
import { Instance } from "../../src/project/instance"
import { SessionPrompt } from "../../src/session/prompt"
import { TaskQueueID } from "../../src/session/schema"
import { TaskQueue } from "../../src/session/task-queue"
import { TaskQueueExecutor } from "../../src/session/task-queue-executor"

const [, , directory, id] = process.argv
const claim = TaskQueue.claimForExecution
TaskQueue.claimForExecution = async (...args) => {
  const release = once(process.stdin, "data")
  process.stdout.write("ready\n")
  await release
  return claim(...args)
}
// Keep a successful claim active until both workers report their decisions.
Object.defineProperty(SessionPrompt, "prompt", { value: () => new Promise(() => {}) })

await Instance.provide({
  directory,
  fn: async () => {
    const result = await TaskQueueExecutor.start(await TaskQueue.get(TaskQueueID.make(id)))
    process.stdout.write(`status ${result.status}\n`)
  },
})
