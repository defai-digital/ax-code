import { createMemo, createSignal, ErrorBoundary, For, Match, Show, Switch } from "solid-js"
import { Dynamic } from "solid-js/web"
import { SplitBorder } from "@tui/component/border"
import { Spinner } from "@tui/component/spinner"
import { Chip } from "@tui/ui/primitives/chip"
import { selectedForeground, tint, useTheme } from "@tui/context/theme"
import type { AssistantMessage, Part, ToolPart, UserMessage, TextPart, ReasoningPart } from "@ax-code/sdk/v2"
import { useLocal } from "@tui/context/local"
import { Locale } from "@/util/locale"
import { effortLabel } from "@/provider/effort-label"
import { useKeybind } from "@tui/context/keybind"
import { Flag } from "@/flag/flag"
import { useKV } from "../../context/kv.tsx"
import { useSync } from "@tui/context/sync"
import { coalesceParts, type DisplayPart } from "./coalesce"
import { autonomousActiveView, isAutonomousProducedMessage, isLiveAutonomousText } from "./autonomous-active"
import { useAutonomousPulse } from "./autonomous-pulse"
import { footerSessionStatusOrIdle } from "./footer-view-model"
import { createStreamPaintThrottle } from "./stream-paint"
import {
  assistantMessageDuration,
  assistantMessageStats,
  assistantToolSummary,
  codeDisplayView,
  compactDelegatedLabel,
  streamingTextRenderMode,
  userMessageMetadataDensity,
} from "./view-model"
import { SessionCodeRenderer } from "./render-adapter"
import { coalescedToolLabel } from "./tool-rendering"
import { toolRendererComponent } from "./tool-renderers"
import { followUpPreview, type QueuedFollowUp } from "../../component/prompt/follow-up-queue"
import { useSessionRouteContext as use } from "./context"
import { userRoute } from "../../util/transcript"
import { routeEvent } from "./route"
import { isAssistantThinkingActive } from "./thinking-status"

export function QueuedFollowUps(props: { items: QueuedFollowUp[] }) {
  const { theme } = useTheme()

  return (
    <Show when={props.items.length > 0}>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} flexShrink={0}>
        <For each={props.items}>
          {(item, index) => (
            <text fg={theme.textMuted} wrapMode="word">
              <span style={{ fg: theme.accent }}>↳</span>
              <span> queued{props.items.length > 1 ? ` ${index() + 1}/${props.items.length}` : ""}: </span>
              <span>{followUpPreview(item, 64)}</span>
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}

const MIME_BADGE: Record<string, string> = {
  "text/plain": "txt",
  "image/png": "img",
  "image/jpeg": "img",
  "image/gif": "img",
  "image/webp": "img",
  "application/pdf": "pdf",
  "application/x-directory": "dir",
}

export function UserMessage(props: {
  message: UserMessage
  parts: Part[]
  onMouseUp: () => void
  index: number
  pending?: string
}) {
  const ctx = use()
  const local = useLocal()
  const text = createMemo(() => props.parts.filter((part): part is TextPart => part.type === "text" && !part.synthetic))
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
  const sync = useSync()
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending && props.message.id > props.pending)
  const color = createMemo(() => local.agent.color(props.message.agent))
  const queuedFg = createMemo(() => selectedForeground(theme, color()))
  const route = createMemo(() => userRoute(props.message, props.parts, sync.data.agent))
  const showPrimary = createMemo(() => props.message.agent !== "build" || route().delegated.length > 0)
  const effort = createMemo(() => (props.message.variant ? effortLabel(props.message.variant) : undefined))
  const metadataDensity = createMemo(() =>
    userMessageMetadataDensity({
      width: ctx.width,
      preference: ctx.userMetadataPreference(),
    }),
  )
  const compactDelegated = createMemo(() => compactDelegatedLabel(route().delegated.length))
  const metadataVisible = createMemo(
    () => queued() || ctx.showTimestamps() || showPrimary() || route().delegated.length > 0 || !!effort(),
  )

  const compaction = createMemo(() => props.parts.find((x) => x.type === "compaction"))

  return (
    <>
      <Show when={text().length > 0 || files().length > 0}>
        <box
          id={props.message.id}
          border={["left"]}
          borderColor={color()}
          customBorderChars={SplitBorder.customBorderChars}
          marginTop={props.index === 0 ? 0 : 1}
        >
          <box
            onMouseOver={() => {
              setHover(true)
            }}
            onMouseOut={() => {
              setHover(false)
            }}
            onMouseUp={props.onMouseUp}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
            flexShrink={0}
          >
            <text marginBottom={1}>
              <span style={{ fg: color() }}>◆ </span>
              <span style={{ fg: theme.text }}>you</span>
            </text>
            <For each={text()}>{(part) => <text fg={theme.text}>{part.text}</text>}</For>
            <Show when={files().length}>
              <box flexDirection="row" paddingBottom={metadataVisible() ? 1 : 0} paddingTop={1} gap={1} flexWrap="wrap">
                <For each={files()}>
                  {(file) => {
                    const bg = createMemo(() => {
                      if (file.mime.startsWith("image/")) return theme.accent
                      if (file.mime === "application/pdf") return theme.primary
                      return theme.secondary
                    })
                    return (
                      <text fg={theme.text}>
                        <span style={{ bg: bg(), fg: theme.background }}> {MIME_BADGE[file.mime] ?? file.mime} </span>
                        <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}> {file.filename} </span>
                      </text>
                    )
                  }}
                </For>
              </box>
            </Show>
            <Show when={metadataVisible()}>
              <Switch>
                <Match when={metadataDensity() === "compact"}>
                  <box flexDirection="row" gap={1} flexWrap="wrap">
                    <Show when={showPrimary()}>
                      <text fg={theme.textMuted}>
                        <span style={{ fg: color() }}>●</span> {route().primary.label}
                      </text>
                    </Show>
                    <Show when={effort()}>
                      <text fg={theme.textMuted}>effort {effort()}</text>
                    </Show>
                    <Show when={compactDelegated()}>
                      <text fg={theme.textMuted}>↳ {compactDelegated()}</text>
                    </Show>
                    <Show
                      when={queued()}
                      fallback={
                        <Show when={ctx.showTimestamps()}>
                          <text fg={theme.textMuted}>{Locale.todayTimeOrDateTime(props.message.time.created)}</text>
                        </Show>
                      }
                    >
                      <text fg={color()}>queued</text>
                    </Show>
                  </box>
                </Match>
                <Match when={true}>
                  <box flexDirection="row" gap={1} flexWrap="wrap">
                    <Show when={showPrimary()}>
                      <text fg={theme.textMuted}>
                        <span style={{ bg: color(), fg: queuedFg(), bold: true }}> {route().primary.label} </span>
                      </text>
                    </Show>
                    <Show when={effort()}>
                      <text fg={theme.textMuted}>effort {effort()}</text>
                    </Show>
                    <For each={route().delegated}>
                      {(item) => {
                        const bg = createMemo(() => local.agent.color(item.name))
                        const fg = createMemo(() => selectedForeground(theme, bg()))
                        return (
                          <text fg={theme.textMuted}>
                            <span style={{ bg: bg(), fg: fg(), bold: true }}> DELEGATED {item.label} </span>
                          </text>
                        )
                      }}
                    </For>
                    <Show
                      when={queued()}
                      fallback={
                        <Show when={ctx.showTimestamps()}>
                          <text fg={theme.textMuted}>
                            <span style={{ fg: theme.textMuted }}>
                              {Locale.todayTimeOrDateTime(props.message.time.created)}
                            </span>
                          </text>
                        </Show>
                      }
                    >
                      <text fg={theme.textMuted}>
                        <span style={{ bg: color(), fg: queuedFg(), bold: true }}> QUEUED </span>
                      </text>
                    </Show>
                  </box>
                </Match>
              </Switch>
            </Show>
          </box>
        </box>
      </Show>
      <Show when={compaction()}>
        {(comp) => {
          const info = comp() as { auto: boolean; overflow?: boolean }
          const title = (info.auto ? "Auto compaction" : "Manual compaction") + (info.overflow ? " · overflow" : "")
          return (
            <box
              marginTop={1}
              border={["top"]}
              title={` ${title} `}
              titleAlignment="center"
              borderColor={theme.borderActive}
            />
          )
        }}
      </Show>
    </>
  )
}

export function RouteIndicator(props: {
  messageID: string
  routeInfoByMessage: () => Map<string, NonNullable<ReturnType<typeof routeEvent>>>
}) {
  const { theme } = useTheme()

  const info = createMemo(() => props.routeInfoByMessage().get(props.messageID) ?? null)

  return (
    <Show when={info()}>
      {(item) => (
        <box paddingLeft={4} paddingBottom={1} flexShrink={0}>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.accent }}>{item().icon}</span>{" "}
            <span style={{ fg: theme.text }}>{item().title}</span>
            {" · "}
            <span style={{ fg: theme.textMuted }}>{item().detail}</span>
          </text>
        </box>
      )}
    </Show>
  )
}

export function AssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
  const local = useLocal()
  const { theme } = useTheme()
  const sync = useSync()
  const kv = useKV()
  const [showAssistantStats] = kv.signal("assistant_stats_visibility", true)
  const messages = createMemo(() => sync.data.message[props.message.sessionID] ?? [])

  const final = createMemo(() => {
    return Boolean(props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish))
  })

  const duration = createMemo(() => {
    if (!final()) return 0
    return assistantMessageDuration(props.message, messages())
  })
  const toolSummary = createMemo(() => assistantToolSummary(props.parts))
  const stats = createMemo(() => (showAssistantStats() ? assistantMessageStats(props.message) : undefined))

  const keybind = useKeybind()

  const hasParts = createMemo(() => props.parts.length > 0)
  // Gate the spinner on live session status so idle/stopped/error runs never
  // leave "Thinking" animating on an incomplete last assistant message (#378).
  const isThinking = createMemo(() => {
    const statusType = sync.data.session_status?.[props.message.sessionID]?.type
    return isAssistantThinkingActive({
      sessionStatusType: statusType,
      messageError: props.message.error,
      hasParts: hasParts(),
      isFinal: final(),
      isLast: props.last,
    })
  })
  // coalesceParts() fabricates new wrapper objects every run and <For> keys
  // rows by identity, so without caching every streamed part would recreate
  // ALL rows — resetting per-row expanded signals on single-part rows
  // mid-turn. Reuse the previous wrapper whenever its inputs are unchanged
  // (part store proxies are identity-stable unless the part itself was
  // replaced) so only genuinely-updated rows are recreated.
  let displayPartCache = new Map<string, DisplayPart>()
  const displayParts = createMemo(() => {
    const cache = new Map<string, DisplayPart>()
    const result = coalesceParts(props.parts).map((entry) => {
      const key = entry.kind === "single" ? `single:${entry.part.id}` : `coalesced:${entry.key}`
      const cached = displayPartCache.get(key)
      const stable = cached && sameDisplayPart(cached, entry) ? cached : entry
      cache.set(key, stable)
      return stable
    })
    displayPartCache = cache
    return result
  })
  // Coalesced-group expand state lives at message scope because a growing
  // run replaces its wrapper (the parts array changes); per-row state inside
  // CoalescedTool would reset every time a new tool call streamed in. Keyed
  // by the run's first callID so a growing run keeps its expanded/collapsed
  // state.
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set())
  const toggleGroup = (key: string, next: boolean) => {
    const current = expandedGroups()
    const updated = new Set(current)
    if (next) updated.add(key)
    else updated.delete(key)
    setExpandedGroups(updated)
  }

  return (
    <>
      <Show when={isThinking()}>
        <box paddingLeft={3} marginTop={1} flexDirection="row" gap={1}>
          <Spinner color={theme.textMuted}>Thinking</Spinner>
        </box>
      </Show>
      <For each={displayParts()}>
        {(entry, index) => {
          const isLast = createMemo(() => index() === displayParts().length - 1)
          return (
            <Switch>
              <Match when={entry.kind === "coalesced" && entry}>
                {(group) => (
                  <CoalescedTool
                    group={group()}
                    message={props.message}
                    expanded={expandedGroups().has(group().key)}
                    onToggle={(next) => toggleGroup(group().key, next)}
                  />
                )}
              </Match>
              <Match when={entry.kind === "single" && entry}>
                {(single) => {
                  const component = createMemo(() => PART_MAPPING[single().part.type as keyof typeof PART_MAPPING])
                  return (
                    <Show when={component()}>
                      <Dynamic
                        last={isLast()}
                        component={component()}
                        part={single().part as any}
                        message={props.message}
                      />
                    </Show>
                  )
                }}
              </Match>
            </Switch>
          )
        }}
      </For>
      <Show when={props.parts.some((x) => x.type === "tool" && x.tool === "task")}>
        <box paddingTop={1} paddingLeft={3}>
          <text fg={theme.text}>
            {keybind.print("session_child_first")}
            <span style={{ fg: theme.textMuted }}> view subagents</span>
          </text>
        </box>
      </Show>
      <Show when={props.message.error && props.message.error.name !== "MessageAbortedError"}>
        <box
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.error}
        >
          <text fg={theme.text}>{String(props.message.error?.data?.message ?? "An error occurred")}</text>
        </box>
      </Show>
      <Switch>
        <Match when={props.last || final() || props.message.error?.name === "MessageAbortedError"}>
          <box paddingLeft={3}>
            <text marginTop={1}>
              <span
                style={{
                  fg:
                    props.message.error?.name === "MessageAbortedError"
                      ? theme.textMuted
                      : local.agent.color(props.message.agent),
                }}
              >
                ◦{" "}
              </span>{" "}
              <span style={{ fg: theme.text }}>
                {sync.data.agent.find((a) => a.name === props.message.agent)?.displayName ??
                  Locale.titlecase(props.message.agent)}
              </span>
              <span style={{ fg: theme.textMuted }}> · {props.message.modelID}</span>
              <Show when={duration()}>
                <span style={{ fg: theme.textMuted }}> · {Locale.duration(duration())}</span>
              </Show>
              <Show when={stats()?.output}>
                <span style={{ fg: theme.textMuted }}> · {stats()!.output} tok</span>
              </Show>
              <Show when={stats()?.rate}>
                <span style={{ fg: theme.textMuted }}> · {stats()!.rate}</span>
              </Show>
              <Show when={stats()?.cacheHit}>
                <span style={{ fg: theme.textMuted }}> · cache {stats()!.cacheHit}</span>
              </Show>
              <For each={toolSummary()}>
                {(item) => (
                  <span style={{ fg: theme.textMuted }}>
                    {" "}
                    · {item.count} {item.label}
                  </span>
                )}
              </For>
              <Show when={props.message.error?.name === "MessageAbortedError"}>
                <span style={{ fg: theme.textMuted }}> · interrupted</span>
              </Show>
            </text>
          </box>
        </Match>
      </Switch>
      <Show when={!props.last && (final() || props.message.error)}>
        <box marginTop={2} marginLeft={3} marginRight={3} border={["top"]} borderColor={theme.borderSubtle} />
      </Show>
    </>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
}

function ReasoningPart(props: { last: boolean; part: ReasoningPart; message: AssistantMessage }) {
  const { theme, subtleSyntax } = useTheme()
  const ctx = use()
  const content = createMemo(() => {
    // Some providers send encrypted reasoning data that appears as [REDACTED].
    return props.part.text.replaceAll("[REDACTED]", "").trim()
  })
  // Throttle the rendered copy while reasoning streams — the renderer
  // re-processes the full document per paint.
  const paintedContent = createStreamPaintThrottle({
    text: content,
    final: () => props.part.time.end !== undefined,
  })
  const display = createMemo(() =>
    codeDisplayView({
      filePath: "thinking.md",
      content: "_Thinking:_ " + paintedContent(),
    }),
  )
  // Show while streaming even before first delta arrives (time.end undefined = still active)
  const visible = createMemo(() => (content() || props.part.time.end === undefined) && ctx.showThinking())
  const streaming = createMemo(() => props.part.time.end === undefined)
  return (
    <Show when={visible()}>
      <box
        id={"text-" + props.part.id}
        paddingLeft={2}
        marginTop={1}
        flexDirection="column"
        border={["left"]}
        customBorderChars={SplitBorder.customBorderChars}
        borderColor={theme.borderSubtle}
      >
        <Switch>
          {/* Plain text while reasoning streams (same paint discipline as
              TextPart); the styled renderer mounts once at finalize. */}
          <Match when={streaming()}>
            <text wrapMode="word" fg={theme.textMuted}>
              {"_Thinking:_ " + paintedContent()}
            </text>
          </Match>
          <Match when={true}>
            <SessionCodeRenderer
              display={display()}
              streaming={false}
              syntaxStyle={subtleSyntax()}
              conceal={ctx.conceal()}
              fg={theme.textMuted}
            />
          </Match>
        </Switch>
      </box>
    </Show>
  )
}

function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  const kv = useKV()
  const [expanded, setExpanded] = createSignal(false)
  // Throttle rich markdown paint while streaming. Store can update faster;
  // re-parsing full markdown every delta dominates TUI main-thread cost, and
  // the interval scales with document length to keep long streams near-linear.
  const paintedText = createStreamPaintThrottle({
    text: () => props.part.text,
    final: () => !!props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish),
  })

  const trimmed = createMemo(() => paintedText().trim())
  const lines = createMemo(() => trimmed().split("\n"))
  const isFinal = createMemo(() => !!props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish))
  // Only fold long completed text. Streaming text always renders in full (via throttle).
  const overflow = createMemo(() => isFinal() && lines().length > 50)
  const visibleText = createMemo(() => {
    if (expanded() || !overflow()) return trimmed()
    return lines().slice(0, 50).join("\n") + "\n…"
  })

  // While streaming, paint the throttled snapshot as plain text — a cheap
  // wrap + buffer write per frame instead of a full markdown parse/highlight
  // (which re-processes the whole accumulated document per paint). The rich
  // renderer mounts exactly once when the message finalizes; the outer box
  // (id text-<part.id>) stays mounted so only the inner renderable swaps.
  const renderMode = createMemo(() =>
    streamingTextRenderMode({ final: isFinal(), experimentalMarkdown: Flag.AX_CODE_EXPERIMENTAL_MARKDOWN }),
  )

  // Autonomous-mode visual: in-flight text inside an active loop gets a
  // diff-add green background (max signal that the run is producing
  // output right now); once the turn settles, the background drops and
  // a thin green left-border stripe stays as a permanent "this answer
  // was autonomous-produced" marker. Both signals derive from a single
  // source (SessionStatus + the message's own step-finish-part count),
  // so they can't desync from the header chip or transcript border.
  const isLiveAutonomous = createMemo(() => {
    const candidate = ctx.sync.data.session_status?.[ctx.sessionID]
    return isLiveAutonomousText({
      last: props.last,
      message: props.message,
      autonomousActive: autonomousActiveView(footerSessionStatusOrIdle(candidate)).active,
    })
  })
  const isAutonomousProduced = createMemo(() => {
    const parts = ctx.sync.data.part[props.message.id] ?? []
    return isAutonomousProducedMessage(parts)
  })
  // Mutually exclusive — live wins while the turn is still running.
  const showStripe = createMemo(() => !isLiveAutonomous() && isAutonomousProduced())
  // Breathing pulse while the autonomous step is in flight. We blend
  // theme.warning onto theme.background at an alpha that oscillates
  // between PULSE_MIN_ALPHA and PULSE_MAX_ALPHA, so the highlight
  // brightens and dims rather than staying flat. The midpoint matches
  // the old static 0.22 so themes that worked before still read the
  // same on average. When animations are disabled the hook returns a
  // constant phase of 0.5 → midpoint alpha → behaves as the old static
  // tint.
  const pulsePhase = useAutonomousPulse(isLiveAutonomous, {
    animationsEnabled: () => kv.get("animations_enabled", true),
  })
  const PULSE_MIN_ALPHA = 0.14
  const PULSE_MAX_ALPHA = 0.3
  const autonomousBg = createMemo(() => {
    const alpha = PULSE_MIN_ALPHA + (PULSE_MAX_ALPHA - PULSE_MIN_ALPHA) * pulsePhase()
    return tint(theme.background, theme.warning, alpha)
  })

  return (
    <Show when={trimmed()}>
      <box
        id={"text-" + props.part.id}
        paddingLeft={3}
        marginTop={1}
        flexShrink={0}
        backgroundColor={isLiveAutonomous() ? autonomousBg() : undefined}
        border={showStripe() ? ["left"] : undefined}
        customBorderChars={SplitBorder.customBorderChars}
        borderColor={showStripe() ? theme.warning : undefined}
      >
        <Switch>
          <Match when={renderMode() === "plain"}>
            <text wrapMode="word" fg={theme.text} bg={isLiveAutonomous() ? autonomousBg() : undefined}>
              {visibleText()}
            </text>
          </Match>
          <Match when={renderMode() === "markdown"}>
            <markdown
              syntaxStyle={syntax()}
              streaming={false}
              content={visibleText()}
              conceal={ctx.conceal()}
              fg={theme.markdownText}
              bg={isLiveAutonomous() ? autonomousBg() : theme.background}
            />
          </Match>
          <Match when={true}>
            <SessionCodeRenderer
              display={codeDisplayView({ filePath: "message.md", content: visibleText() })}
              streaming={false}
              syntaxStyle={syntax()}
              conceal={ctx.conceal()}
              fg={theme.text}
            />
          </Match>
        </Switch>
        <Show when={overflow()}>
          <text fg={theme.textMuted} onMouseUp={() => setExpanded((prev) => !prev)}>
            {expanded() ? "Click to collapse" : `… ${lines().length - 50} more lines · click to expand`}
          </text>
        </Show>
      </box>
    </Show>
  )
}

// Pending messages moved to individual tool pending functions

function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const ctx = use()
  const sync = useSync()
  const { theme } = useTheme()

  // Hide tool if showDetails is false and tool completed successfully
  const shouldHide = createMemo(() => {
    if (ctx.showDetails()) return false
    if (props.part.state.status !== "completed") return false
    return true
  })

  const toolprops = {
    get metadata() {
      return props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
    },
    get input() {
      return props.part.state.input ?? {}
    },
    get output() {
      return props.part.state.status === "completed" ? props.part.state.output : undefined
    },
    get permission() {
      const permissions = sync.data.permission[props.message.sessionID] ?? []
      const permissionIndex = permissions.findIndex((x) => x.tool?.callID === props.part.callID)
      return permissions[permissionIndex]
    },
    get tool() {
      return props.part.tool
    },
    get part() {
      return props.part
    },
  }

  return (
    <Show when={!shouldHide()}>
      <ErrorBoundary
        fallback={
          <box paddingLeft={3} flexDirection="row" gap={1}>
            <text fg={theme.warning}>{"▲"}</text>
            <text fg={theme.textMuted}>failed to render {props.part.tool} output</text>
          </box>
        }
      >
        <Dynamic component={toolRendererComponent(props.part.tool)} {...toolprops} />
      </ErrorBoundary>
    </Show>
  )
}

function CoalescedTool(props: {
  group: { tool: string; parts: ToolPart[]; key: string }
  message: AssistantMessage
  expanded: boolean
  onToggle: (next: boolean) => void
}) {
  const { theme } = useTheme()
  const label = createMemo(() => coalescedToolLabel(props.group.tool, props.group.parts.length))
  // Any in-flight part means the group is still mid-stream — without
  // a spinner the collapsed row reads as "done" even when reads are
  // still landing one-by-one.
  const isRunning = createMemo(() =>
    props.group.parts.some((p) => p.state.status === "running" || p.state.status === "pending"),
  )
  return (
    <Show
      when={props.expanded}
      fallback={
        <box paddingLeft={3} flexDirection="row">
          <Chip status={isRunning() ? "running" : "done"} spinner={isRunning()} onMouseUp={() => props.onToggle(true)}>
            {label()} <span style={{ fg: theme.borderSubtle }}>▸</span>
          </Chip>
        </box>
      }
    >
      <For each={props.group.parts}>{(part) => <ToolPart last={false} part={part} message={props.message} />}</For>
      <box paddingLeft={3}>
        <text paddingLeft={3} fg={theme.borderSubtle} onMouseUp={() => props.onToggle(false)}>
          ▾ collapse
        </text>
      </box>
    </Show>
  )
}

// Two DisplayPart wrappers are interchangeable when they reference the exact
// same part objects — store proxies keep their identity unless the underlying
// part was replaced by a sync event, so this only misses when the part (or a
// coalesced run's membership) actually changed.
function sameDisplayPart(a: DisplayPart, b: DisplayPart): boolean {
  if (a.kind === "single" && b.kind === "single") return a.part === b.part
  if (a.kind === "coalesced" && b.kind === "coalesced")
    return a.key === b.key && a.parts.length === b.parts.length && a.parts.every((part, i) => part === b.parts[i])
  return false
}
