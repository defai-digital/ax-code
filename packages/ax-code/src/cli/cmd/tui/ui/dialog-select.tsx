import { InputRenderable, RGBA, ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { batch, createEffect, createMemo, For, Show, type JSX, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { isDeepEqual } from "remeda"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { useKeybind } from "@tui/context/keybind"
import { scheduleMicrotaskTask } from "@tui/util/microtask"
import { useToast } from "@tui/ui/toast"
import { Keybind } from "@/util/keybind"
import { Locale } from "@/util/locale"
import { Log } from "@/util/log"
import {
  dialogSelectClampIndex,
  dialogSelectActionOption,
  dialogSelectFlatOptions,
  dialogSelectGroupedOptions,
  dialogSelectMoveIndex,
  dialogSelectRows,
  dialogSelectVisibleHeight,
} from "./dialog-select-view-model"

const log = Log.create({ service: "tui.dialog-select" })

export interface DialogSelectProps<T> {
  title: string
  placeholder?: string
  options: DialogSelectOption<T>[]
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
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    selected: 0,
    filter: "",
    input: "keyboard" as "keyboard" | "mouse",
  })

  let input: InputRenderable

  const flatten = createMemo(() => props.flat && store.filter.length > 0)

  const grouped = createMemo<[string, DialogSelectOption<T>[]][]>(() => {
    return dialogSelectGroupedOptions({
      options: props.options,
      query: store.filter,
      flat: flatten(),
      skipFilter: props.skipFilter,
    })
  })

  const flat = createMemo(() => {
    return dialogSelectFlatOptions(grouped())
  })

  createEffect(
    on(
      () => props.current,
      (current) => {
        if (current) {
          const currentIndex = flat().findIndex((opt) => isDeepEqual(opt.value, current))
          if (currentIndex >= 0) {
            setStore("selected", currentIndex)
          }
        }
      },
    ),
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

  const dimensions = useTerminalDimensions()
  const height = createMemo(() => dialogSelectVisibleHeight(rows(), dimensions().height))
  // Show the vertical scrollbar only when the list is taller than the viewport.
  const overflow = createMemo(() => rows() > height())

  const selected = createMemo(() => dialogSelectActionOption(flat(), store.selected))

  createEffect(
    on([() => store.filter, () => props.current], ([filter, current]) => {
      const cancel = scheduleMicrotaskTask(() => {
        if (filter.length > 0) {
          moveTo(0, true)
        } else if (current) {
          const currentIndex = flat().findIndex((opt) => isDeepEqual(opt.value, current))
          if (currentIndex >= 0) {
            moveTo(currentIndex, true)
          }
        }
      })
      onCleanup(cancel)
    }),
  )

  function move(direction: number) {
    const options = flat()
    if (options.length === 0) return
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
    setStore("selected", next)
    const option = selected()
    if (option) props.onMove?.(option)
    if (!scroll) return
    const target = scroll.getChildren().find((child) => child.id === optionID(next))
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

  let confirmInFlight = false
  function confirmSelected() {
    if (confirmInFlight) return
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
      () => {
        if (option.onSelect) option.onSelect(dialog)
        props.onSelect?.(option)
      },
      "dialog select action failed",
      "Failed to complete the selected action",
    ).finally(() => {
      confirmInFlight = false
    })
  }

  const keybind = useKeybind()
  useKeyboard((evt) => {
    setStore("input", "keyboard")

    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) move(-1)
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) move(1)
    if (evt.name === "pageup") move(-10)
    if (evt.name === "pagedown") move(10)
    if (evt.name === "home") moveTo(0)
    if (evt.name === "end") moveTo(flat().length - 1)

    if (evt.name === "return") {
      evt.preventDefault()
      evt.stopPropagation()
      confirmSelected()
      return
    }

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

  const keybinds = createMemo(() => props.keybind?.filter((x) => !x.disabled && x.keybind) ?? [])

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.title}
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <box paddingTop={1}>
          <input
            onSubmit={confirmSelected}
            keyBindings={[{ name: "return", action: "submit" }]}
            onInput={(e) => {
              batch(() => {
                setStore("filter", e)
                props.onFilter?.(e)
              })
            }}
            focusedBackgroundColor={theme.backgroundElement}
            cursorColor={theme.primary}
            focusedTextColor={theme.textMuted}
            ref={(r) => {
              input = r
              const cancel = scheduleMicrotaskTask(() => {
                if (!input) return
                if (input.isDestroyed) return
                input.focus()
              })
              onCleanup(cancel)
            }}
            placeholder={props.placeholder ?? "Search"}
          />
        </box>
      </box>
      <Show
        when={grouped().length > 0}
        fallback={
          <box paddingLeft={4} paddingRight={4} paddingTop={1}>
            <text fg={theme.textMuted}>No results found</text>
          </box>
        }
      >
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
              // Thumb uses the theme's primary accent (same color as the
              // selected-row highlight) so the scrollbar stays clearly visible
              // against any selected theme; the track stays subtle.
              backgroundColor: theme.backgroundElement,
              foregroundColor: theme.primary,
            },
          }}
          ref={(r: ScrollBoxRenderable) => (scroll = r)}
          maxHeight={height()}
        >
          <For each={grouped()}>
            {([category, options], index) => (
              <>
                <Show when={category}>
                  <box paddingTop={index() > 0 ? 1 : 0} paddingLeft={3}>
                    <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                      {category}
                    </text>
                  </box>
                </Show>
                <For each={options}>
                  {(option) => {
                    const optionIndex = createMemo(() => flat().findIndex((x) => isDeepEqual(x.value, option.value)))
                    const active = createMemo(() => isDeepEqual(option.value, selected()?.value))
                    const current = createMemo(() => isDeepEqual(option.value, props.current))
                    return (
                      <box
                        id={optionIndex() >= 0 ? optionID(optionIndex()) : undefined}
                        flexDirection="row"
                        onMouseMove={() => {
                          setStore("input", "mouse")
                        }}
                        onMouseUp={() => {
                          if (option.disabled) return
                          void runDialogSelectAction(
                            () => {
                              option.onSelect?.(dialog)
                              props.onSelect?.(option)
                            },
                            "dialog select action failed",
                            "Failed to complete the selected action",
                          )
                        }}
                        onMouseOver={() => {
                          if (store.input !== "mouse") return
                          const index = flat().findIndex((x) => isDeepEqual(x.value, option.value))
                          if (index === -1) return
                          moveTo(index)
                        }}
                        onMouseDown={() => {
                          const index = flat().findIndex((x) => isDeepEqual(x.value, option.value))
                          if (index === -1) return
                          moveTo(index)
                        }}
                        backgroundColor={
                          active()
                            ? option.disabled
                              ? theme.backgroundElement
                              : (option.bg ?? theme.primary)
                            : RGBA.fromInts(0, 0, 0, 0)
                        }
                        paddingLeft={current() || option.gutter ? 1 : 3}
                        paddingRight={3}
                        gap={1}
                      >
                        <Option
                          title={option.title}
                          footer={flatten() ? (option.category ?? option.footer) : option.footer}
                          description={option.description !== category ? option.description : undefined}
                          descriptionFg={option.descriptionFg}
                          active={active()}
                          current={current()}
                          disabled={option.disabled}
                          gutter={option.gutter}
                        />
                      </box>
                    )
                  }}
                </For>
              </>
            )}
          </For>
        </scrollbox>
      </Show>
      <Show when={keybinds().length} fallback={<box flexShrink={0} />}>
        <box paddingRight={2} paddingLeft={4} flexDirection="row" gap={2} flexShrink={0} paddingTop={1}>
          <For each={keybinds()}>
            {(item) => (
              <text>
                <span style={{ fg: theme.text }}>
                  <b>{item.title}</b>{" "}
                </span>
                <span style={{ fg: theme.textMuted }}>{Keybind.toString(item.keybind)}</span>
              </text>
            )}
          </For>
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
  const fg = selectedForeground(theme)

  return (
    <>
      <Show when={props.current}>
        <text flexShrink={0} fg={props.active ? fg : props.current ? theme.primary : theme.text} marginRight={0}>
          ●
        </text>
      </Show>
      <Show when={!props.current && props.gutter}>
        <box flexShrink={0} marginRight={0}>
          {props.gutter}
        </box>
      </Show>
      <text
        flexGrow={1}
        fg={props.disabled ? theme.textMuted : props.active ? fg : props.current ? theme.primary : theme.text}
        attributes={props.active && !props.disabled ? TextAttributes.BOLD : undefined}
        overflow="visible"
        wrapMode="word"
        paddingLeft={3}
      >
        {Locale.truncate(props.title, 61)}
        <Show when={props.description}>
          <span
            style={{
              fg: props.disabled ? theme.textMuted : props.active ? fg : (props.descriptionFg ?? theme.textMuted),
            }}
          >
            {" "}
            {props.description}
          </span>
        </Show>
      </text>
      <Show when={props.footer}>
        <box flexShrink={0}>
          <text fg={props.disabled ? theme.textMuted : props.active ? fg : theme.textMuted}>{props.footer}</text>
        </box>
      </Show>
    </>
  )
}
