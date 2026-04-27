import { Select as Kobalte } from "@kobalte/core/select"
import { entries, groupBy, map, pipe } from "remeda"
import { createMemo, onCleanup, splitProps, type ComponentProps, type JSX } from "solid-js"
import { Button, ButtonProps } from "../actions/button"
import { Icon } from "../icon"

export type SelectProps<T> = Omit<ComponentProps<typeof Kobalte<T>>, "value" | "onSelect" | "children"> & {
  placeholder?: string
  options: T[]
  current?: T
  value?: (x: T) => string
  label?: (x: T) => string
  groupBy?: (x: T) => string
  valueClass?: ComponentProps<"div">["class"]
  onSelect?: (value: T | undefined) => void
  onHighlight?: (value: T | undefined) => (() => void) | void
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  children?: (item: T | undefined) => JSX.Element
  triggerStyle?: JSX.CSSProperties
  triggerVariant?: "settings"
  triggerProps?: Record<string, string | number | boolean | undefined>
}

export function Select<T>(props: SelectProps<T> & Omit<ButtonProps, "children">) {
  const [local, others] = splitProps(props, [
    "class",
    "classList",
    "placeholder",
    "options",
    "current",
    "value",
    "label",
    "groupBy",
    "valueClass",
    "onSelect",
    "onHighlight",
    "onOpenChange",
    "children",
    "triggerStyle",
    "triggerVariant",
    "triggerProps",
  ])

  const state = {
    key: undefined as string | undefined,
    cleanup: undefined as (() => void) | void,
  }
  const fallbackObjectValues = new WeakMap<object, string>()
  let nextFallbackObjectValue = 0

  const stop = () => {
    state.cleanup?.()
    state.cleanup = undefined
    state.key = undefined
  }

  const keyFor = (item: T) => {
    if (local.value) return local.value(item)
    if (typeof item === "string") return item
    if (typeof item === "number" || typeof item === "boolean" || typeof item === "bigint") {
      return String(item)
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>
      for (const field of ["id", "value", "key"] as const) {
        const candidate = record[field]
        if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "bigint") {
          return String(candidate)
        }
      }
      let fallback = fallbackObjectValues.get(item)
      if (!fallback) {
        fallback = `select-option-${nextFallbackObjectValue++}`
        fallbackObjectValues.set(item, fallback)
      }
      return fallback
    }
    return String(item ?? "")
  }

  const labelFor = (item: T) => {
    if (local.label) return local.label(item)
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || typeof item === "bigint") {
      return String(item)
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>
      for (const field of ["label", "name", "title", "id", "value"] as const) {
        const candidate = record[field]
        if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "bigint") {
          return String(candidate)
        }
      }
    }
    return keyFor(item)
  }

  const move = (item: T | undefined) => {
    if (!local.onHighlight) return
    if (!item) {
      stop()
      return
    }

    const key = keyFor(item)
    if (state.key === key) return
    state.cleanup?.()
    state.cleanup = local.onHighlight(item)
    state.key = key
  }

  onCleanup(stop)

  const grouped = createMemo(() => {
    return pipe(
      local.options,
      groupBy((x) => (local.groupBy ? local.groupBy(x) : "")),
      entries(),
      map(([k, v]) => ({ category: k, options: v })),
    )
  })

  return (
    // @ts-ignore
    <Kobalte<T, { category: string; options: T[] }>
      {...others}
      data-component="select"
      data-trigger-style={local.triggerVariant}
      placement={local.triggerVariant === "settings" ? "bottom-end" : "bottom-start"}
      gutter={4}
      value={local.current}
      options={grouped()}
      optionValue={keyFor}
      optionTextValue={labelFor}
      optionGroupChildren="options"
      placeholder={local.placeholder}
      sectionComponent={(item) => (
        <Kobalte.Section data-slot="select-section">{item.section.rawValue.category}</Kobalte.Section>
      )}
      itemComponent={(itemProps) => (
        <Kobalte.Item
          {...itemProps}
          data-slot="select-select-item"
          classList={{
            ...(local.classList ?? {}),
            [local.class ?? ""]: !!local.class,
          }}
          onPointerEnter={() => move(itemProps.item.rawValue)}
          onPointerMove={() => move(itemProps.item.rawValue)}
          onFocus={() => move(itemProps.item.rawValue)}
        >
          <Kobalte.ItemLabel data-slot="select-select-item-label">
            {local.children ? local.children(itemProps.item.rawValue) : labelFor(itemProps.item.rawValue)}
          </Kobalte.ItemLabel>
          <Kobalte.ItemIndicator data-slot="select-select-item-indicator">
            <Icon name="check-small" size="small" />
          </Kobalte.ItemIndicator>
        </Kobalte.Item>
      )}
      onChange={(v) => {
        local.onSelect?.(v ?? undefined)
        stop()
      }}
      onOpenChange={(open) => {
        local.onOpenChange?.(open)
        if (!open) stop()
      }}
    >
      <Kobalte.Trigger
        {...local.triggerProps}
        disabled={props.disabled}
        data-slot="select-select-trigger"
        as={Button}
        size={props.size}
        variant={props.variant}
        style={local.triggerStyle}
        classList={{
          ...(local.classList ?? {}),
          [local.class ?? ""]: !!local.class,
        }}
      >
        <Kobalte.Value<T> data-slot="select-select-trigger-value" class={local.valueClass}>
          {(state) => {
            const selected = state.selectedOption() ?? local.current
            if (!selected) return local.placeholder || ""
            return labelFor(selected)
          }}
        </Kobalte.Value>
        <Kobalte.Icon data-slot="select-select-trigger-icon">
          <Icon name={local.triggerVariant === "settings" ? "selector" : "chevron-down"} size="small" />
        </Kobalte.Icon>
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          classList={{
            ...(local.classList ?? {}),
            [local.class ?? ""]: !!local.class,
          }}
          data-component="select-content"
          data-trigger-style={local.triggerVariant}
        >
          <Kobalte.Listbox data-slot="select-select-content-list" />
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
