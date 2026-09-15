import type { HeadlessRuntimeEvent } from "@/runtime/headless/event"

export type SyncEvent<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
> = HeadlessRuntimeEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart>
