import { Button } from "@ax-code/ui/button"
import { Icon } from "@ax-code/ui/icon"
import { List } from "@ax-code/ui/list"
import { Popover } from "@ax-code/ui/popover"
import { createSignal, type ComponentProps } from "solid-js"
import type { SlashCommand } from "./slash-popover"

type PromptRecipePopoverProps = {
  items: SlashCommand[]
  onSelect: (item: SlashCommand) => void
  commandKeybind: (id: string) => string | undefined
  t: (key: string) => string
  triggerStyle?: ComponentProps<"button">["style"]
  disabled?: boolean
}

function group(cmd: SlashCommand, t: (key: string) => string) {
  if (cmd.category) return cmd.category
  if (cmd.type === "builtin") return t("prompt.recipe.group.builtin")
  if (cmd.source === "skill") return t("prompt.recipe.group.skill")
  if (cmd.source === "mcp") return t("prompt.recipe.group.mcp")
  return t("prompt.recipe.group.project")
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
        groupBy={(item) => group(item, props.t)}
        onSelect={(item) => {
          if (!item) return
          setOpen(false)
          props.onSelect(item)
        }}
      >
        {(item) => (
          <div class="w-full flex items-center justify-between gap-3">
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
