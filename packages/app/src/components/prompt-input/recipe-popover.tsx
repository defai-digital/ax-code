import { Button } from "@ax-code/ui/button"
import { Icon } from "@ax-code/ui/icon"
import { List } from "@ax-code/ui/list"
import { Popover } from "@ax-code/ui/popover"
import { Show, createSignal, type ComponentProps } from "solid-js"
import { slashGroup, slashGroupRank, type SlashCommand } from "./slash-popover"

type PromptRecipePopoverProps = {
  items: SlashCommand[]
  onSelect: (item: SlashCommand) => void
  pinned?: (id: string) => boolean
  onTogglePin?: (id: string) => void
  commandKeybind: (id: string) => string | undefined
  t: (key: string) => string
  triggerStyle?: ComponentProps<"button">["style"]
  disabled?: boolean
}

export function PromptRecipePopover(props: PromptRecipePopoverProps) {
  const [open, setOpen] = createSignal(false)

  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      title={props.t("prompt.recipe.title")}
      description={props.t("prompt.recipe.description")}
      triggerAs={Button}
      triggerProps={{
        type: "button",
        variant: "ghost",
        size: "normal",
        style: props.triggerStyle,
        class: "min-w-0 max-w-[160px] text-13-regular text-text-base",
        "data-action": "prompt-recipes",
        "aria-label": props.t("prompt.recipe.open"),
        disabled: props.disabled,
      }}
      trigger={
        <>
          <Icon name="bullet-list" size="small" class="shrink-0" />
          <span class="truncate">{props.t("prompt.recipe.open")}</span>
          <Icon name="chevron-down" size="small" class="shrink-0" />
        </>
      }
      class="w-[420px] max-w-[min(420px,calc(100vw-24px))]"
    >
      <List
        class="px-0"
        search={{ placeholder: props.t("prompt.recipe.search.placeholder"), autofocus: true }}
        emptyMessage={props.t("prompt.recipe.empty")}
        key={(item) => item.id}
        items={props.items}
        filterKeys={["trigger", "title", "description"]}
        groupBy={(item) => slashGroup(item, props.t)}
        sortGroupsBy={(a, b) => slashGroupRank(a.category, props.t) - slashGroupRank(b.category, props.t)}
        itemWrapper={(item, node) => (
          <div class="relative">
            {node}
            <Show when={props.onTogglePin}>
              <button
                type="button"
                classList={{
                  "absolute right-2 top-1/2 -translate-y-1/2 z-10 h-6 rounded px-2 text-11-medium transition-colors": true,
                  "bg-surface-base text-text-strong": !!props.pinned?.(item.id),
                  "text-text-subtle hover:text-text-strong hover:bg-surface-base": !props.pinned?.(item.id),
                }}
                aria-label={
                  props.pinned?.(item.id) ? props.t("prompt.recipe.action.unpin") : props.t("prompt.recipe.action.pin")
                }
                onMouseDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  props.onTogglePin?.(item.id)
                }}
              >
                {props.pinned?.(item.id) ? props.t("prompt.recipe.action.unpin") : props.t("prompt.recipe.action.pin")}
              </button>
            </Show>
          </div>
        )}
        onSelect={(item) => {
          if (!item) return
          setOpen(false)
          props.onSelect(item)
        }}
      >
        {(item) => (
          <div class="w-full flex items-center justify-between gap-3 pr-14">
            <div class="min-w-0 flex items-center gap-2">
              <code class="text-12-medium text-text-strong whitespace-nowrap">/{item.trigger}</code>
              <div class="min-w-0 flex flex-col">
                <span class="text-13-medium text-text-strong truncate">{item.title}</span>
                <span class="text-12-regular text-text-weak truncate">{item.description || item.trigger}</span>
              </div>
            </div>
            <div class="shrink-0 flex items-center gap-2">
              {item.type === "custom" && item.source !== "command" && (
                <span class="text-11-regular text-text-subtle px-1.5 py-0.5 bg-surface-base rounded">
                  {item.source === "skill"
                    ? props.t("prompt.slash.badge.skill")
                    : item.source === "mcp"
                      ? props.t("prompt.slash.badge.mcp")
                      : props.t("prompt.slash.badge.custom")}
                </span>
              )}
              {props.commandKeybind(item.id) && (
                <span class="text-12-regular text-text-subtle">{props.commandKeybind(item.id)}</span>
              )}
            </div>
          </div>
        )}
      </List>
    </Popover>
  )
}
