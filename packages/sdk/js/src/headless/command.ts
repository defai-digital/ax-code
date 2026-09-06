/** Whether a runtime command should be accepted synchronously or queued asynchronously. */
export type HeadlessRuntimeCommandMode = "sync" | "async"

/** Model selector: a string id or `{ providerID, modelID }`. */
export type HeadlessRuntimeModel =
  | string
  | {
      providerID: string
      modelID: string
    }

/** One prompt/command part (`type` plus arbitrary fields). */
export type HeadlessRuntimePart = {
  type: string
  [key: string]: unknown
}

/** Body of a `session.prompt` runtime command. */
export type HeadlessPromptBody = {
  parts: HeadlessRuntimePart[]
  agent?: string
  model?: HeadlessRuntimeModel
  variant?: string
  messageID?: string
  noReply?: boolean
  tools?: Record<string, boolean>
  [key: string]: unknown
}

/** Body of a `session.command` runtime command. */
export type HeadlessCommandBody = {
  command: string
  arguments?: string
  agent?: string
  model?: HeadlessRuntimeModel
  variant?: string
  messageID?: string
  parts?: HeadlessRuntimePart[]
  [key: string]: unknown
}

/** Body of a `session.shell` runtime command. */
export type HeadlessShellBody = {
  command: string
  agent?: string
  model?: HeadlessRuntimeModel
  variant?: string
  messageID?: string
  [key: string]: unknown
}

/** Body of a `permission.reply` runtime command. */
export type HeadlessPermissionReplyBody = {
  requestID: string
  reply?: "once" | "always" | "reject"
  [key: string]: unknown
}

/** Body of a `question.reply` runtime command. */
export type HeadlessQuestionReplyBody = {
  requestID: string
  answers: unknown
  [key: string]: unknown
}

/** Discriminated union of commands a headless client can send to the runtime. */
export type HeadlessRuntimeCommand =
  | {
      type: "session.prompt"
      mode?: HeadlessRuntimeCommandMode
      sessionID: string
      body: HeadlessPromptBody
    }
  | {
      type: "session.command"
      mode?: HeadlessRuntimeCommandMode
      sessionID: string
      body: HeadlessCommandBody
    }
  | {
      type: "session.shell"
      mode?: HeadlessRuntimeCommandMode
      sessionID: string
      body: HeadlessShellBody
    }
  | {
      type: "session.abort"
      sessionID: string
    }
  | {
      type: "permission.reply"
      body: HeadlessPermissionReplyBody
    }
  | {
      type: "question.reply"
      body: HeadlessQuestionReplyBody
    }

/** Accepted result of sending a runtime command (`200` with body or `202` queued). */
export type HeadlessRuntimeCommandResult =
  | { accepted: true; status: 202; body?: undefined }
  | { accepted: true; status: 200; body: unknown }

/** Whether a runtime command may be sent with `mode: "async"`. */
export function commandAcceptsAsyncMode(command: HeadlessRuntimeCommand) {
  return command.type === "session.prompt" || command.type === "session.command" || command.type === "session.shell"
}
