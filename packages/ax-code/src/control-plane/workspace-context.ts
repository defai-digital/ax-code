import { Context } from "@/util/context"

const ctx = Context.create<{
  workspaceID: string
}>("workspace")

export namespace WorkspaceContext {
  export function use() {
    return ctx.use()
  }

  export function provide<R>(input: { workspaceID: string; fn: () => R }) {
    return ctx.provide({ workspaceID: input.workspaceID }, input.fn)
  }
}
