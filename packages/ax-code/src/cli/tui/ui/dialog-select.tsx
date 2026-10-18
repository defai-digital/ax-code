import { createDialogOptionKey, solidVirtualRow, DIALOG_SELECT_VIRTUAL_THRESHOLD } from "./dialog-select-virtual"
import { useLanguage } from "@tui/context/language"
import {
  InputRenderable,
  RGBA,
  ScrollBoxRenderable,
  TextAttributes,
  VirtualListRenderable,
  type BoxRenderable,
} from "ax-tui"
import { tint, useTheme } from "@tui/context/theme"
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  type JSX,
  type Accessor,
  getOwner,
  on,
  onCleanup,
  untrack,
} from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useTerminalDimensions, VirtualList } from "ax-tui/solid"
import { isDeepEqual } from "remeda"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { useKeybind } from "@tui/context/keybind"
import { scheduleMicrotaskTask } from "@tui/util/microtask"
import { scheduleTuiTimeout } from "@tui/util/timer"
import { CONFIRM_KEYS } from "@tui/util/keys"
import { findRenderableChild, focusRenderable, isRenderableAlive } from "@tui/util/renderable-safety"
import { useToast } from "@tui/ui/toast"
import { Keybind } from "@/util/keybind"
import { stringWidth } from "@/bun/node-compat"
import { Log } from "@/util/log"
import {
  dialogSelectClampIndex,
  dialogSelectActionOption,
  dialogSelectFlatOptions,
  dialogSelectGroupStartIndex,
  dialogSelectGroupedOptions,
  dialogSelectHasCurrentValue,
  dialogSelectFooterHints,
  dialogSelectMoveIndex,
  dialogSelectOptionLine,
  dialogSelectRows,
  dialogSelectTitleWidth,
  dialogSelectVisibleHeight,
} from "./dialog-select-view-model"
import { dialogOverlayWidth } from "./dialog-overlay"
import { truncateCells } from "./cell-text"

const log = Log.create({ service: "tui.dialog-select" })

const DIALOG_SELECT_COMPACT_FRAME_WIDTH = 48

export interface DialogSelectProps<T> {
  title: string
  placeholder?: string
  options: DialogSelectOption<T>[]
  /** Stable application identity for object-valued options when their objects are recreated. */
  getKey?: (option: DialogSelectOption<T>) => string | number
  flat?: boolean
  ref?: (ref: DialogSelectRef<T>) => void
  onMove?: (option: DialogSelectOption<T>) => void
  onFilter?: (query: string) => void
  onSelect?: (option: DialogSelectOption<T>) => void
  skipFilter?: boolean
  keybind?: {
    keybind?: Keybind.Info
    title: string
    disabled?: boolean
    onTrigger: (option: DialogSelectOption<T>) => void
  }[]
  /** Muted footer line after the keybind hints, for interaction guidance that is not a single key. */
  hint?: string
  current?: T
}

export interface DialogSelectOption<T = any> {
  title: string
  value: T
  description?: string
  descriptionFg?: RGBA
  footer?: JSX.Element | string
  category?: string
  disabled?: boolean
  bg?: RGBA
  gutter?: JSX.Element
  onSelect?: (ctx: DialogContext) => void
}

export type DialogSelectRef<T> = {
  filter: string
  filtered: DialogSelectOption<T>[]
}

export function DialogSelect<T>(props: DialogSelectProps<T>) {
  const { t } = useLanguage()
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    selected: 0,
    filter: "",
    input: "keyboard" as "keyboard" | "mouse",
  })

  let input: InputRenderable

  function clearSearch() {
    if (!store.filter || !isRenderableAlive(input)) return false
    // The native setter emits INPUT, keeping the query, cursor, and external
    // onFilter consumer synchronized through the normal input path.
    input.value = ""
    return true
  }
  onCleanup(dialog.registerEscapeHandler(clearSearch))

  const flatten = createMemo(() => props.flat && store.filter.length > 0)
  // JSX getters may build new option objects on every read. Share one snapshot
  // between grouping and key assignment so both see the same row identities.
  const options = createMemo(() => props.options)

  const grouped = createMemo<[string, DialogSelectOption<T>[]][]>(() => {
    return dialogSelectGroupedOptions({
      options: options(),
      query: store.filter,
      flat: flatten(),
      skipFilter: props.skipFilter,
    })
  })

  const flat = createMemo(() => {
    return dialogSelectFlatOptions(grouped())
  })

  // Track the current value's position as asynchronous options arrive or move.
  // Unrelated option updates must not reset a cursor the user has already moved.
  const currentIndex = createMemo(() =>
    dialogSelectHasCurrentValue(props.current) ? flat().findIndex((opt) => isDeepEqual(opt.value, props.current)) : -1,
  )
  createEffect(
    on(currentIndex, (index) => {
      if (index >= 0) setStore("selected", index)
    }),
  )

  // When the filter changes due to how TUI works, the mousemove might still be triggered
  // via a synthetic event as the layout moves underneath the cursor. This is a workaround to make sure the input mode remains keyboard
  // that the mouseover event doesn't trigger when filtering.
  createEffect(() => {
    grouped()
    setStore("input", "keyboard")
  })

  createEffect(() => {
    const next = dialogSelectClampIndex(store.selected, flat().length)
    const option = flat()[next]
    const enabledIndex = option?.disabled === true ? flat().findIndex((candidate) => candidate.disabled !== true) : next
    const clamped = enabledIndex >= 0 ? enabledIndex : next
    if (clamped !== store.selected) setStore("selected", clamped)
  })

  const rows = createMemo(() => dialogSelectRows(grouped()))
  const rowOwner = getOwner()
  const valueKey = createDialogOptionKey()
  const optionKeys = createMemo(() => {
    const keys = new Map<DialogSelectOption<T>, string[]>()
    const counts = new Map<string, number>()
    for (const option of options()) {
      const base = JSON.stringify([option.category ?? "", props.getKey?.(option) ?? valueKey(option.value)])
      const occurrence = counts.get(base) ?? 0
      counts.set(base, occurrence + 1)
      const list = keys.get(option) ?? []
      list.push(`option:${base}:${occurrence}`)
      keys.set(option, list)
    }
    return keys
  })
  type VirtualRow = {
    key: string
    category: string
    header: boolean
    gap: boolean
    option?: DialogSelectOption<T>
    index: number
  }
  const virtualRows = createMemo(() => {
    const result: VirtualRow[] = []
    const seen = new Map<DialogSelectOption<T>, number>()
    const keys = optionKeys()
    let index = 0
    for (const [groupIndex, [category, options]] of grouped().entries()) {
      if (category) result.push({ key: `header:${category}`, category, header: true, gap: groupIndex > 0, index: -1 })
      for (const option of options) {
        const occurrence = seen.get(option) ?? 0
        seen.set(option, occurrence + 1)
        result.push({ key: keys.get(option)![occurrence], category, header: false, gap: false, option, index: index++ })
      }
    }
    return result
  })
  // Existing JSX footers/gutters can be mounted only once. Keep their ownership
  // on the ordinary path; primitive rows can be retired and recreated safely.
  const virtualized = createMemo(
    () =>
      rows() > DIALOG_SELECT_VIRTUAL_THRESHOLD &&
      options().every((option) => !option.gutter && (option.footer == null || typeof option.footer === "string")),
  )

  const dimensions = useTerminalDimensions()
  const height = createMemo(() => dialogSelectVisibleHeight(rows(), dimensions().height))
  // Show the vertical scrollbar only when the list is taller than the viewport.
  const overflow = createMemo(() => rows() > height())

  const selected = createMemo(() => dialogSelectActionOption(flat(), store.selected))

  createEffect(
    on([() => store.filter, currentIndex], ([filter, index]) => {
      const cancel = scheduleMicrotaskTask(
        () => {
          if (filter.length > 0) {
            moveTo(0, true)
          } else if (index >= 0) {
            moveTo(index, true)
          }
          revealSelected() // rows may lack layout on open
        },
        {
          name: "dialog-select-current-option",
        },
      )
      onCleanup(cancel)
    }),
  )

  function move(direction: number) {
    const options = flat()
    if (options.length === 0) return
    // Page jumps (|direction| > 1) clamp at the list edges instead of wrapping;
    // when the landing row is disabled, single-step to the nearest enabled
    // option (onward first, then back) rather than re-jumping by the page size.
    if (Math.abs(direction) > 1) {
      const landing = dialogSelectMoveIndex(store.selected, direction, options.length)
      const onward = direction > 0 ? 1 : -1
      for (const step of [onward, -onward]) {
        for (let next = landing; next >= 0 && next < options.length; next += step) {
          if (options[next]?.disabled !== true) {
            if (next !== store.selected) moveTo(next, true)
            return
          }
        }
      }
      return
    }
    let next = store.selected
    for (let i = 0; i < options.length; i++) {
      next = dialogSelectMoveIndex(next, direction, options.length)
      if (options[next]?.disabled !== true) {
        moveTo(next, true)
        return
      }
    }
  }

  function optionID(index: number) {
    return `dialog-select-option-${index}`
  }

  function moveTo(next: number, center = false) {
    const previous = store.selected
    setStore("selected", next)
    const option = selected()
    if (option) props.onMove?.(option)
    if (!scroll) return
    const target = findRenderableChild<{ id?: string; y: number }>(scroll, (child) => child.id === optionID(next), {
      name: "dialog-select-option-target",
    })
    if (!target && scroll instanceof VirtualListRenderable) {
      const index = virtualRows().findIndex((row) => !row.header && row.index === next)
      if (index >= 0) scroll.scrollToIndex(index, center ? "center" : next > previous ? "end" : "start")
      return
    }
    if (!target) return
    const y = target.y - scroll.y
    if (center) {
      const centerOffset = Math.floor(scroll.height / 2)
      scroll.scrollBy(y - centerOffset)
    } else {
      if (y >= scroll.height) {
        scroll.scrollBy(y - scroll.height + 1)
      }
      if (y < 0) {
        scroll.scrollBy(y)
        const first = flat()[0]
        if (first && isDeepEqual(first.value, selected()?.value)) {
          scroll.scrollTo(0)
        }
      }
    }
  }

  // Bring the selected row into the viewport (centered) when it is not fully
  // visible. Runs after layout, unlike moveTo calls made before rows exist.
  let stopReveal: (() => void) | undefined
  function revealSelected() {
    stopReveal?.()
    stopReveal = scheduleTuiTimeout(
      () => {
        if (!scroll || scroll.isDestroyed) return
        const target = findRenderableChild<{ id?: string; y: number; height: number }>(
          scroll,
          (child) => child.id === optionID(store.selected),
          { name: "dialog-select-reveal-target" },
        )
        if (!target && scroll instanceof VirtualListRenderable) {
          const index = virtualRows().findIndex((row) => !row.header && row.index === store.selected)
          if (index >= 0) scroll.scrollToIndex(index, "center")
          return
        }
        if (!target) return
        const top = target.y - scroll.viewport.y
        if (top >= 0 && top + target.height <= scroll.viewport.height) return
        scroll.scrollBy(top - Math.floor(scroll.viewport.height / 2))
      },
      { name: "dialog-select-reveal-selected", delayMs: 16, unref: true },
    )
  }
  onCleanup(() => stopReveal?.())

  function runDialogSelectAction(action: () => unknown, failureLabel: string, failureMessage: string) {
    return Promise.resolve()
      .then(action)
      .catch((error) => {
        log.warn(failureLabel, { error, title: props.title })
        toast.show({
          message: error instanceof Error ? error.message : failureMessage,
          variant: "error",
        })
      })
  }

  // Nested dialogs opened from an Enter keypress (e.g. Providers → "already
  // connected") used to inherit a residual submit/return from the parent
  // dialog. That immediately confirmed the first nested option ("Use saved
  // key") and made Disconnect / Replace key unreachable. Ignore confirm for a
  // short window after mount; arrow/mouse interaction arms confirm early.
  const openedAt = Date.now()
  const CONFIRM_GRACE_MS = 150
  let confirmArmed = false
  function armConfirm() {
    confirmArmed = true
  }

  let confirmInFlight = false
  function confirmSelected() {
    if (confirmInFlight) return
    if (!confirmArmed && Date.now() - openedAt < CONFIRM_GRACE_MS) return
    confirmArmed = true
    const option = selected()
    if (!option) return
    if (option.disabled) {
      toast.show({
        message: option.description ?? `${option.title} is not selectable`,
        variant: "warning",
        duration: 3000,
      })
      return
    }
    confirmInFlight = true
    void runDialogSelectAction(
      // Return the handlers' promises so the confirmInFlight latch spans the
      // real async work (blocking double-fires) and rejections reach the
      // catch/toast in runDialogSelectAction instead of floating unhandled.
      () => Promise.all([option.onSelect?.(dialog), props.onSelect?.(option)]),
      "dialog select action failed",
      "Failed to complete the selected action",
    ).finally(() => {
      confirmInFlight = false
    })
  }

  const keybind = useKeybind()
  useKeyboard((evt) => {
    setStore("input", "keyboard")

    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      armConfirm()
      move(-1)
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      armConfirm()
      move(1)
    }
    if (evt.name === "pageup") {
      armConfirm()
      move(-Math.max(1, height() - 1))
    }
    if (evt.name === "pagedown") {
      armConfirm()
      move(Math.max(1, height() - 1))
    }
    if (evt.name === "home") {
      armConfirm()
      move(-Math.max(2, flat().length))
    }
    if (evt.name === "end") {
      armConfirm()
      move(Math.max(2, flat().length))
    }

    if (CONFIRM_KEYS.has(evt.name)) {
      evt.preventDefault()
      evt.stopPropagation()
      confirmSelected()
      return
    }

    // A bare-key dialog shortcut (e.g. space to pause/resume) must not fire
    // while the user is typing a filter query: the key belongs to the input,
    // and triggering the action would also swallow the character.
    const typingQuery =
      store.filter.length > 0 &&
      !evt.ctrl &&
      !evt.meta &&
      !evt.super &&
      (evt.name === "space" || evt.name === " " || evt.sequence?.length === 1)
    if (!typingQuery) {
      for (const item of props.keybind ?? []) {
        if (item.disabled || !item.keybind) continue
        if (Keybind.match(item.keybind, keybind.parse(evt))) {
          const s = selected()
          if (s) {
            evt.preventDefault()
            void runDialogSelectAction(
              () => item.onTrigger(s),
              "dialog select keybind failed",
              `Failed to run ${item.title}`,
            )
          }
        }
      }
    }
  })

  let scroll: ScrollBoxRenderable | undefined
  const ref: DialogSelectRef<T> = {
    get filter() {
      return store.filter
    },
    get filtered() {
      return flat()
    },
  }
  props.ref?.(ref)

  // Frame width mirrors the Dialog frame (ui/dialog.tsx) so header and footer
  // budgets follow the real viewport instead of a fixed character count.
  const frameWidth = createMemo(() => dialogOverlayWidth(dialog.size === "large" ? 80 : 60, dimensions().width))
  const escLabel = createMemo(() => (store.filter ? "esc clear" : "esc"))
  const title = createMemo(() => truncateCells(props.title, dialogSelectTitleWidth(frameWidth(), escLabel())))
  // Whole hints only: at narrow widths trailing hints drop instead of wrapping
  // or being cut mid-token.
  const keybinds = createMemo(() =>
    dialogSelectFooterHints(
      (props.keybind?.filter((x) => !x.disabled && x.keybind) ?? []).map((item) => ({
        ...item,
        width: stringWidth(Keybind.toString(item.keybind)) + 1 + stringWidth(item.title),
      })),
      frameWidth(),
    ),
  )

  function renderOption(option: DialogSelectOption<T>, optionIndex: Accessor<number>, category: Accessor<string>) {
    const active = createMemo(() => optionIndex() === store.selected)
    const current = createMemo(() => isDeepEqual(option.value, props.current))
    return (
      <box
        id={optionID(optionIndex())}
        flexDirection="row"
        onMouseMove={() => {
          armConfirm()
          setStore("input", "mouse")
        }}
        onMouseUp={() => {
          if (option.disabled) return
          // Route clicks through confirmSelected so the
          // confirmInFlight latch also guards the mouse path
          // against double-fires.
          armConfirm()
          const row = optionIndex()
          if (row !== store.selected) moveTo(row)
          confirmSelected()
        }}
        onMouseOver={() => {
          if (store.input !== "mouse") return
          armConfirm()
          moveTo(optionIndex())
        }}
        onMouseDown={() => {
          armConfirm()
          moveTo(optionIndex())
        }}
        backgroundColor={
          active()
            ? option.disabled
              ? theme.backgroundElement
              : // One accent-tinted panel fill for both theme
                // modes (a purple selection reads as "chosen",
                // not "success"); option.bg still overrides.
                (option.bg ?? tint(theme.backgroundPanel, theme.accent, 0.3))
            : RGBA.fromInts(0, 0, 0, 0)
        }
        paddingLeft={current() || option.gutter ? 1 : 3}
        // Narrow frames trade the right inset for label room.
        paddingRight={frameWidth() < DIALOG_SELECT_COMPACT_FRAME_WIDTH ? 1 : 3}
        gap={1}
      >
        {/* Selection marker cell: a "›" on the active row, a
        space elsewhere, so option text never shifts. */}
        <text flexShrink={0} fg={theme.secondary}>
          {active() ? "›" : " "}
        </text>
        <Option
          title={option.title}
          footer={flatten() ? (option.category ?? option.footer) : option.footer}
          description={option.description !== category() ? option.description : undefined}
          descriptionFg={option.descriptionFg}
          active={active()}
          current={current()}
          disabled={option.disabled}
          gutter={option.gutter}
        />
      </box>
    )
  }

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
            {title()}
          </text>
          <text
            fg={theme.textMuted}
            onMouseUp={() => {
              if (!clearSearch()) dialog.clear()
            }}
          >
            {escLabel()}
          </text>
        </box>
        <box paddingTop={1}>
          <input
            onSubmit={confirmSelected}
            keyBindings={[{ name: "return", action: "submit" }]}
            onInput={(e: string) => {
              armConfirm()
              batch(() => {
                setStore("filter", e)
                props.onFilter?.(e)
              })
            }}
            focusedBackgroundColor={theme.backgroundElement}
            cursorColor={theme.primary}
            focusedTextColor={theme.textMuted}
            ref={(r: InputRenderable) => {
              input = r
              const cancel = scheduleMicrotaskTask(
                () => {
                  focusRenderable(input, { name: "dialog-select-filter-focus" })
                },
                {
                  name: "dialog-select-filter-focus",
                },
              )
              onCleanup(cancel)
            }}
            placeholder={props.placeholder ?? t("common.search")}
          />
        </box>
      </box>
      <Show
        when={grouped().length > 0}
        fallback={
          <box paddingLeft={4} paddingRight={4} paddingTop={1}>
            <text fg={theme.textMuted}>{t("common.noResults")}</text>
          </box>
        }
      >
        <Show
          when={virtualized()}
          fallback={
            <scrollbox
              paddingLeft={1}
              // When the scrollbar is shown, the viewport's paddingRight provides the
              // content-to-bar gap, so drop the outer paddingRight to avoid stacking
              // it (which would inset the bar from the edge and shift the content
              // margin as the bar toggles).
              paddingRight={overflow() ? 0 : 1}
              viewportOptions={{
                paddingRight: overflow() ? 1 : 0,
              }}
              verticalScrollbarOptions={{
                paddingLeft: 1,
                visible: overflow(),
                trackOptions: {
                  // Neutral, high-contrast thumb (a chrome affordance, not an
                  // identity/status color); the track stays subtle.
                  backgroundColor: theme.backgroundElement,
                  foregroundColor: theme.borderActive,
                },
              }}
              ref={(r: ScrollBoxRenderable) => (scroll = r)}
              onSizeChange={revealSelected}
              maxHeight={height()}
            >
              <For each={grouped()}>
                {([category, options], index) => {
                  const groupStart = createMemo(() => dialogSelectGroupStartIndex(grouped(), index()))
                  return (
                    <>
                      <Show when={category}>
                        <box paddingTop={index() > 0 ? 1 : 0} paddingLeft={3}>
                          <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
                            {category}
                          </text>
                        </box>
                      </Show>
                      <For each={options}>
                        {(option, optionOffset) => {
                          // Index identity so the same model can appear in Recent and
                          // again under its provider without both rows highlighting.
                          const optionIndex = createMemo(() => groupStart() + optionOffset())
                          return renderOption(option, optionIndex, () => category)
                        }}
                      </For>
                    </>
                  )
                }}
              </For>
            </scrollbox>
          }
        >
          <VirtualList
            items={virtualRows()}
            getKey={(row) => row.key}
            renderItem={(row) =>
              solidVirtualRow(rowOwner, () => (
                <box paddingLeft={1} paddingRight={1}>
                  {row.header ? (
                    <box paddingTop={row.gap ? 1 : 0} paddingLeft={3}>
                      <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
                        {row.category}
                      </text>
                    </box>
                  ) : (
                    renderOption(
                      row.option!,
                      () => row.index,
                      () => row.category,
                    )
                  )}
                </box>
              ))
            }
            estimateHeight={1}
            overscan={3}
            height={height()}
            paddingLeft={1}
            paddingRight={overflow() ? 0 : 1}
            viewportOptions={{ paddingRight: overflow() ? 1 : 0 }}
            verticalScrollbarOptions={{
              paddingLeft: 1,
              visible: overflow(),
              trackOptions: {
                backgroundColor: theme.backgroundElement,
                foregroundColor: theme.borderActive,
              },
            }}
            ref={(value) => {
              scroll = value
              revealSelected()
            }}
            onSizeChange={revealSelected}
          />
        </Show>
      </Show>
      {/* No footer, no placeholder: an empty box would still cost a gap row,
          which short terminals need for options (36x20 setup wizard). */}
      <Show when={keybinds().length || props.hint}>
        <box paddingRight={2} paddingLeft={4} flexDirection="row" gap={2} flexShrink={0} paddingTop={1}>
          <For each={keybinds()}>
            {(item) => (
              // Same grammar as the KeyHint primitive: the key in the text
              // color (bold) first, then the muted action label.
              <text>
                <span style={{ fg: theme.text }}>
                  <b>{Keybind.toString(item.keybind)}</b>{" "}
                </span>
                <span style={{ fg: theme.textMuted }}>{item.title}</span>
              </text>
            )}
          </For>
          <Show when={props.hint}>
            <text fg={theme.textMuted} wrapMode="word">
              {props.hint}
            </text>
          </Show>
        </box>
      </Show>
    </box>
  )
}

function Option(props: {
  title: string
  description?: string
  descriptionFg?: RGBA
  active?: boolean
  current?: boolean
  footer?: JSX.Element | string
  gutter?: JSX.Element
  disabled?: boolean
  onMouseOver?: () => void
}) {
  const { theme } = useTheme()
  // The selected row now uses a neutral text color on the accent-tinted fill;
  // selectedForeground / theme.selectedListItemText were tuned for the old
  // solid-primary fill and are intentionally no longer consulted here.

  // Measured cell width of the title text slot (0 until the first layout),
  // plus whether the footer column was on screen when it was measured. The
  // slot is flex-sized by the row, so it does not depend on the text it holds
  // and the measure cannot feed back into itself.
  const [measured, setMeasured] = createSignal({ width: 0, withFooter: false })
  let slotRef: BoxRenderable | undefined
  const footerWidth = createMemo(() => (typeof props.footer === "string" ? stringWidth(props.footer) : undefined))
  const line = createMemo(() => {
    const sample = measured()
    const plainFooter = footerWidth()
    // Re-add the footer column (and its one-cell row gap) when it was on
    // screen, so the plan always sees the same full budget either way.
    const slot = sample.width > 0 ? sample.width + (sample.withFooter && plainFooter ? plainFooter + 1 : 0) : 0
    return dialogSelectOptionLine({
      slotWidth: slot,
      title: props.title,
      description: props.description,
      footerWidth: plainFooter,
    })
  })
  const footerVisible = () => Boolean(props.footer) && line().showFooter
  function measure() {
    if (!slotRef) return
    const width = slotRef.width
    const withFooter = untrack(footerVisible)
    const previous = untrack(measured)
    if (previous.width === width && previous.withFooter === withFooter) return
    setMeasured({ width, withFooter })
  }

  return (
    <>
      <Show when={props.current}>
        <text flexShrink={0} fg={props.active ? theme.text : theme.secondary} marginRight={0}>
          ●
        </text>
      </Show>
      <Show when={!props.current && props.gutter}>
        <box flexShrink={0} marginRight={0}>
          {props.gutter}
        </box>
      </Show>
      {/* The slot box is flex-sized by the row and measured; the text inside
          is pre-fitted to it, so it never relies on clipping mid-glyph. */}
      <box
        ref={(r: BoxRenderable) => (slotRef = r)}
        onSizeChange={measure}
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        minWidth={0}
        height={1}
        overflow="hidden"
      >
        <text
          fg={
            props.disabled ? theme.textMuted : props.active ? theme.text : props.current ? theme.secondary : theme.text
          }
          attributes={props.active && !props.disabled ? TextAttributes.BOLD : undefined}
          // One painted row per option. Word-wrap made 4–5 provider actions look
          // like three rows and hid the scrollbar (viewport height counted
          // options, not wrapped lines).
          wrapMode="none"
        >
          {line().title}
          <Show when={line().description}>
            <span
              style={{
                fg: props.disabled
                  ? theme.textMuted
                  : props.active
                    ? theme.text
                    : (props.descriptionFg ?? theme.textMuted),
              }}
            >
              {" "}
              {line().description}
            </span>
          </Show>
        </text>
      </box>
      <Show when={footerVisible()}>
        <box flexShrink={0}>
          <text fg={props.disabled ? theme.textMuted : props.active ? theme.text : theme.textMuted}>
            {props.footer}
          </text>
        </box>
      </Show>
    </>
  )
}

/** Open a standard select list as a dialog. Mirrors `DialogConfirm.show`. */
DialogSelect.show = <T,>(dialog: DialogContext, props: Omit<DialogSelectProps<T>, "ref">) => {
  dialog.replace(() => <DialogSelect<T> {...props} />)
}
