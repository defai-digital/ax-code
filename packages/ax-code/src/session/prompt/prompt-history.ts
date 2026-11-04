import { Plugin } from "../../plugin"
import { PluginData } from "../../plugin/data"
import type { MessageV2 } from "../message-v2"

/** Apply request-only transformations without rewriting the source transcript. */
export async function transformPromptHistory(messages: MessageV2.WithParts[]) {
  const hasTransformPlugin = (await Plugin.list()).some((hook) => hook["experimental.chat.messages.transform"])
  // Hook commits mutate caller-held objects. Detach history before a hook can
  // change nested parts or accumulate changes across steps/compaction retries.
  // Preserve object identity for the conversion cache when no hook is active.
  const output = await Plugin.trigger(
    "experimental.chat.messages.transform",
    {},
    { messages: hasTransformPlugin ? PluginData.copy(messages) : messages },
  )
  return { messages: output.messages, cacheAllowed: !hasTransformPlugin }
}
