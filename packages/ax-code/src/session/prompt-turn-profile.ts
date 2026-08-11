import { MessageV2 } from "./message-v2"

export type ResponseOnlyIntent = "translate" | "reformat" | "shorten" | "rewrite"

export type TurnExecutionProfile =
  | { kind: "default"; reason: string }
  | {
      kind: "response-only"
      intent: ResponseOnlyIntent
      reason: string
      sourceAssistantID: MessageV2.Assistant["id"]
      currentUserID: MessageV2.User["id"]
      requestMessages: MessageV2.WithParts[]
      sourceTextChars: number
      promptTextChars: number
    }

export const RESPONSE_ONLY_SYSTEM_PROMPT = [
  "<response_only_turn>",
  "This turn only transforms the immediately preceding assistant answer.",
  "Do not inspect the workspace, call tools, continue the coding task, or add new repository findings.",
  "Follow the user's requested language, length, tone, or format while preserving the answer's meaning and important caveats.",
  "Return only the transformed answer.",
  "</response_only_turn>",
].join("\n")

const LANGUAGE_TARGET = [
  "traditional\\s+chinese",
  "simplified\\s+chinese",
  "trad\\.?\\s+chinese",
  "t\\.?\\s*chinese",
  "chinese",
  "english",
  "spanish",
  "french",
  "german",
  "japanese",
  "korean",
  "portuguese",
  "italian",
  "russian",
  "arabic",
  "hindi",
  "繁體中文",
  "繁体中文",
  "簡體中文",
  "简体中文",
  "中文",
  "英文",
  "日文",
  "韓文",
  "韩文",
].join("|")

const LANGUAGE_ONLY_PATTERNS = [
  new RegExp(
    `^(?:please\\s+)?(?:tell\\s+me|say\\s+(?:it|that|this)|answer|reply|respond)(?:\\s+(?:to\\s+me))?\\s+in\\s+(?:${LANGUAGE_TARGET})(?:\\s+please)?[.!?。！？]*$`,
    "i",
  ),
  new RegExp(`^(?:please\\s+)?in\\s+(?:${LANGUAGE_TARGET})(?:\\s+please)?[.!?。！？]*$`, "i"),
  new RegExp(
    `^(?:please\\s+)?translate(?:\\s+(?:that|it|this|the\\s+above|the\\s+(?:last|previous)\\s+answer|your\\s+(?:last|previous)?\\s*(?:answer|response)))?\\s+(?:to|into)\\s+(?:${LANGUAGE_TARGET})(?:\\s+please)?[.!?。！？]*$`,
    "i",
  ),
  /^(?:請|请)?(?:用|改用)(?:繁體中文|繁体中文|簡體中文|简体中文|中文|英文|日文|韓文|韩文)(?:回答|回覆|回复|再說一次|再说一次)?[。！？.!?]*$/,
]

const REWRITE_PATTERNS: Array<{ intent: Exclude<ResponseOnlyIntent, "translate">; pattern: RegExp }> = [
  {
    intent: "rewrite",
    pattern:
      /^(?:please\s+)?(?:rewrite|rephrase|paraphrase|restate|repeat|summari[sz]e)\s+(?:that|it|this|the\s+above|the\s+(?:last|previous)\s+answer|your\s+(?:last|previous)?\s*(?:answer|response)|the\s+answer)(?:\s+.{1,100})?[.!?]*$/i,
  },
  {
    intent: "shorten",
    pattern:
      /^(?:please\s+)?(?:make\s+)?(?:that|it|this|the\s+above|the\s+answer|your\s+(?:answer|response))\s+(?:shorter|more\s+concise|brief|a\s+tldr|a\s+tl;dr)(?:\s+please)?[.!?]*$/i,
  },
  {
    intent: "reformat",
    pattern:
      /^(?:please\s+)?(?:make|format|turn)\s+(?:that|it|this|the\s+above|the\s+answer|your\s+(?:answer|response))\s+(?:as|into)\s+(?:a\s+)?(?:bullet(?:ed)?\s*(?:point|list)?s?|table|checklist|markdown)(?:\s+please)?[.!?]*$/i,
  },
  {
    intent: "shorten",
    pattern: /^(?:shorter|more\s+concise|brief(?:er)?|tldr|tl;dr)(?:\s+please)?[.!?]*$/i,
  },
  {
    intent: "reformat",
    pattern: /^(?:as\s+)?(?:bullet(?:ed)?\s*(?:point|list)?s?|a\s+table|a\s+checklist|markdown)(?:\s+please)?[.!?]*$/i,
  },
  {
    intent: "rewrite",
    pattern:
      /^(?:same\s+answer|the\s+same)(?:,?\s+but)?\s+(?:shorter|more\s+concise|more\s+formal|more\s+casual|friendlier|clearer|in\s+plain\s+language)[.!?]*$/i,
  },
  {
    intent: "rewrite",
    pattern:
      /^(?:請|请)?(?:把)?(?:上面|上面的|剛才|刚才|這個|这个)?(?:回答|答案|內容|内容|它|這段|这段)(?:改寫|改写|重寫|重写|縮短|缩短|整理)(?:成|為|为)?[^\n]{0,80}[。！？.!?]*$/,
  },
]

const REPOSITORY_OR_EDIT_SIGNAL =
  /\b(?:app|ui|code|source|file|repo(?:sitory)?|project|workspace|i18n|l10n|locale|locali[sz]ation|implement|edit|modify|change|fix|patch|refactor|commit|push|pull\s+request|component|function|class|test|readme)\b|(?:程式|代码|代碼|原始碼|源码|檔案|文件|專案|项目|應用|应用|介面|界面|本地化|國際化|国际化|實作|实现|修改|編輯|编辑|修復|修复|提交)/i

const PATH_OR_CODE_SIGNAL =
  /`[^`]+`|(?:^|\s)(?:\.\.?\/|\/)[^\s]+|\b[\w.-]+\.(?:c|cc|cpp|css|go|h|hpp|html|java|js|jsx|json|md|php|po|py|rb|rs|sh|swift|toml|ts|tsx|vue|yaml|yml)\b/i

const MULTI_TASK_SIGNAL = /\b(?:also|and\s+then|then\s+also)\b|(?:另外|然後|然后|並且|并且)/i

function defaultProfile(reason: string): TurnExecutionProfile {
  return { kind: "default", reason }
}

function usableText(parts: MessageV2.Part[]) {
  return parts
    .filter(
      (part): part is MessageV2.TextPart =>
        part.type === "text" && !part.ignored && !part.synthetic && part.text.trim().length > 0,
    )
    .map((part) => part.text.trim())
}

function responseOnlyIntent(text: string): ResponseOnlyIntent | undefined {
  if (LANGUAGE_ONLY_PATTERNS.some((pattern) => pattern.test(text))) return "translate"
  for (const candidate of REWRITE_PATTERNS) {
    if (candidate.pattern.test(text)) return candidate.intent
  }
  return undefined
}

export function detectTurnExecutionProfile(input: {
  messages: MessageV2.WithParts[]
  currentUser: MessageV2.User
}): TurnExecutionProfile {
  if (input.currentUser.format && input.currentUser.format.type !== "text") return defaultProfile("structured_output")

  const currentIndex = input.messages.findIndex((message) => message.info.id === input.currentUser.id)
  if (currentIndex === -1) return defaultProfile("current_user_missing")
  if (currentIndex !== input.messages.length - 1) return defaultProfile("queued_or_later_messages")

  const current = input.messages[currentIndex]
  if (current.info.role !== "user") return defaultProfile("current_message_not_user")
  if (current.parts.some((part) => part.type !== "text" || part.synthetic || part.ignored)) {
    return defaultProfile("non_text_or_synthetic_user_part")
  }

  const userTextParts = usableText(current.parts)
  if (userTextParts.length === 0) return defaultProfile("empty_user_text")
  const userText = userTextParts.join("\n").trim().replace(/\s+/g, " ")
  if (userText.length > 240 || userTextParts.length > 3) return defaultProfile("prompt_too_large")
  if (REPOSITORY_OR_EDIT_SIGNAL.test(userText)) return defaultProfile("repository_or_edit_signal")
  if (PATH_OR_CODE_SIGNAL.test(userText)) return defaultProfile("path_or_code_signal")
  if (MULTI_TASK_SIGNAL.test(userText)) return defaultProfile("multi_task_signal")

  const intent = responseOnlyIntent(userText)
  if (!intent) return defaultProfile("no_response_transform_intent")

  const source = input.messages[currentIndex - 1]
  if (!source || source.info.role !== "assistant") return defaultProfile("no_immediate_assistant")
  if (source.info.finish !== "stop" || source.info.error || source.info.summary) {
    return defaultProfile("assistant_not_completed_text")
  }

  const sourceTextParts = usableText(source.parts)
  if (sourceTextParts.length === 0) return defaultProfile("assistant_has_no_text")

  const projectedAssistant: MessageV2.WithParts = {
    info: { ...source.info },
    parts: source.parts
      .filter(
        (part): part is MessageV2.TextPart =>
          part.type === "text" && !part.ignored && !part.synthetic && part.text.trim().length > 0,
      )
      .map((part) => ({ ...part })),
  }
  const projectedUser: MessageV2.WithParts = {
    info: { ...current.info },
    parts: current.parts.map((part) => ({ ...part })),
  }

  return {
    kind: "response-only",
    intent,
    reason: `previous_answer_${intent}`,
    sourceAssistantID: source.info.id,
    currentUserID: current.info.id,
    requestMessages: [projectedAssistant, projectedUser],
    sourceTextChars: sourceTextParts.join("\n").length,
    promptTextChars: userText.length,
  }
}

export function responseOnlyUsesFastReasoning(user: Pick<MessageV2.User, "requestedDepth" | "variant">): boolean {
  if (user.requestedDepth !== undefined && user.requestedDepth !== "fast") return false
  const variant = user.variant?.trim().toLowerCase()
  return variant === undefined || variant === "" || variant === "auto" || variant === "default"
}
