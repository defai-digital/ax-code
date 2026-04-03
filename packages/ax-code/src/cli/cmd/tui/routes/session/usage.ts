import type { AssistantMessage, Message } from "@ax-code/sdk/v2"

export namespace Usage {
  export function total(msg: Pick<AssistantMessage, "tokens">) {
    if (msg.tokens.total) return msg.tokens.total
    return msg.tokens.input + msg.tokens.output + msg.tokens.cache.read + msg.tokens.cache.write
  }

  export function hasUsage(msg: Pick<AssistantMessage, "tokens">) {
    return total(msg) > 0 || msg.tokens.reasoning > 0
  }

  export function last(msgs: Message[]) {
    return msgs.findLast((msg): msg is AssistantMessage => msg.role === "assistant" && hasUsage(msg))
  }
}
