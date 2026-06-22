import type { Message, Part } from "@ax-code/sdk/v2"

export type SessionMessageRecord = {
  info: Message
  parts: Part[]
}
