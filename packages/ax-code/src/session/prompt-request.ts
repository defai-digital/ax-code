import type { ModelMessage } from "ai"
import type { MessageV2 } from "./message-v2"
import { Token } from "@/util/token"

export function estimateRequestTokens(input: { system: string[]; messages: ModelMessage[] }) {
  let total = 0
  for (const item of input.system) {
    total += Token.estimate(item) + 4
  }
  for (const message of input.messages) {
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content)
    total += Token.estimate(content) + 4
  }
  return total
}

export function getLastUserInfo(messages: readonly MessageV2.WithParts[]): MessageV2.User | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.info.role === "user") {
      return message.info
    }
  }
  return undefined
}
