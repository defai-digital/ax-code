export type HeadlessRuntimeCommandMode = "sync" | "async"

export type HeadlessRuntimeModel =
  | string
  | {
      providerID: string
      modelID: string
    }

export type HeadlessRuntimePart = {
  type: string
  [key: string]: unknown
}

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

export type HeadlessShellBody = {
  command: string
  agent?: string
  model?: HeadlessRuntimeModel
  variant?: string
  messageID?: string
  [key: string]: unknown
}

export type HeadlessPermissionReplyBody = {
  requestID: string
  reply?: "once" | "always" | "reject"
  [key: string]: unknown
}

export type HeadlessQuestionReplyBody = {
  requestID: string
  answers: unknown
  [key: string]: unknown
}

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

export type HeadlessRuntimeCommandResult =
  | { accepted: true; status: 202; body?: undefined }
  | { accepted: true; status: 200; body: unknown }

export function commandAcceptsAsyncMode(command: HeadlessRuntimeCommand) {
  return command.type === "session.prompt" || command.type === "session.command" || command.type === "session.shell"
}
