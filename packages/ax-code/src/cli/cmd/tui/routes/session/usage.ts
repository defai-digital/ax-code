import type { AssistantMessage, Message } from "@ax-code/sdk/v2"

export namespace Usage {
  export function total(msg: Pick<AssistantMessage, "tokens">) {
    return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
  }

  export function last(msgs: Message[]) {
    return msgs.findLast((msg): msg is AssistantMessage => msg.role === "assistant" && total(msg) > 0)
  }
}
