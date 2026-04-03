import { Component, For, Match, Show, Switch, createMemo } from "solid-js"
import { FileIcon } from "@ax-code/ui/file-icon"
import { Icon } from "@ax-code/ui/icon"
import { getDirectory, getFilename } from "@ax-code/util/path"

export type AtOption =
  | { type: "agent"; name: string; display: string }
  | { type: "file"; path: string; display: string; recent?: boolean }

export interface SlashCommand {
  id: string
  trigger: string
  title: string
  description?: string
  category?: string
  keybind?: string
  type: "builtin" | "custom"
  source?: "command" | "mcp" | "skill"
}

export function slashGroup(cmd: SlashCommand, t: (key: string) => string) {
  if (cmd.category) return cmd.category
  if (cmd.type === "builtin") return t("prompt.recipe.group.builtin")
  if (cmd.source === "skill") return t("prompt.recipe.group.skill")
  if (cmd.source === "mcp") return t("prompt.recipe.group.mcp")
  return t("prompt.recipe.group.project")
}

export function slashGroupRank(category: string, t: (key: string) => string) {
  if (category === t("prompt.recipe.group.pinned")) return 0
  if (category === t("prompt.recipe.group.recent")) return 1
  if (category === t("prompt.recipe.group.recommended")) return 2
  if (category === t("prompt.recipe.group.builtin")) return 3
  if (category === t("prompt.recipe.group.project")) return 4
  if (category === t("prompt.recipe.group.skill")) return 5
  if (category === t("prompt.recipe.group.mcp")) return 6
  return 7
}

type PromptPopoverProps = {
  popover: "at" | "slash" | null
  setSlashPopoverRef: (el: HTMLDivElement) => void
  atFlat: AtOption[]
  atActive?: string
  atKey: (item: AtOption) => string
  setAtActive: (id: string) => void
  onAtSelect: (item: AtOption) => void
  slashFlat: SlashCommand[]
  slashActive?: string
  setSlashActive: (id: string) => void
  onSlashSelect: (item: SlashCommand) => void
  commandKeybind: (id: string) => string | undefined
  t: (key: string) => string
}

export const PromptPopover: Component<PromptPopoverProps> = (props) => {
  const slashRows = createMemo(() =>
    props.slashFlat.map((cmd, index, list) => {
      const category = slashGroup(cmd, props.t)
      const prev = list[index - 1]
      const next = prev ? slashGroup(prev, props.t) : undefined
      return {
        cmd,
        category,
        showGroup: category !== next,
      }
    }),
  )

  return (
    <Show when={props.popover}>
      <div
        ref={(el) => {
          if (props.popover === "slash") props.setSlashPopoverRef(el)
        }}
        class="absolute inset-x-0 -top-2 -translate-y-full origin-bottom-left max-h-80 min-h-10
                 overflow-auto no-scrollbar flex flex-col p-2 rounded-[12px]
                 bg-surface-raised-stronger-non-alpha shadow-[var(--shadow-lg-border-base)]"
        onMouseDown={(e) => e.preventDefault()}
      >
        <Switch>
          <Match when={props.popover === "at"}>
            <Show
              when={props.atFlat.length > 0}
              fallback={<div class="text-text-weak px-2 py-1">{props.t("prompt.popover.emptyResults")}</div>}
            >
              <For each={props.atFlat.slice(0, 10)}>
                {(item) => {
                  const key = props.atKey(item)

                  if (item.type === "agent") {
                    return (
                      <button
                        class="w-full flex items-center gap-x-2 rounded-md px-2 py-0.5"
                        classList={{ "bg-surface-raised-base-hover": props.atActive === key }}
                        onClick={() => props.onAtSelect(item)}
                        onMouseEnter={() => props.setAtActive(key)}
                      >
                        <Icon name="brain" size="small" class="text-icon-info-active shrink-0" />
                        <span class="text-14-regular text-text-strong whitespace-nowrap">@{item.name}</span>
                      </button>
                    )
                  }

                  const isDirectory = item.path.endsWith("/")
                  const directory = isDirectory ? item.path : getDirectory(item.path)
                  const filename = isDirectory ? "" : getFilename(item.path)

                  return (
                    <button
                      class="w-full flex items-center gap-x-2 rounded-md px-2 py-0.5"
                      classList={{ "bg-surface-raised-base-hover": props.atActive === key }}
                      onClick={() => props.onAtSelect(item)}
                      onMouseEnter={() => props.setAtActive(key)}
                    >
                      <FileIcon node={{ path: item.path, type: "file" }} class="shrink-0 size-4" />
                      <div class="flex items-center text-14-regular min-w-0">
                        <span class="text-text-weak whitespace-nowrap truncate min-w-0">{directory}</span>
                        <Show when={!isDirectory}>
                          <span class="text-text-strong whitespace-nowrap">{filename}</span>
                        </Show>
                      </div>
                    </button>
                  )
                }}
              </For>
            </Show>
          </Match>
          <Match when={props.popover === "slash"}>
            <Show
              when={props.slashFlat.length > 0}
              fallback={<div class="text-text-weak px-2 py-1">{props.t("prompt.popover.emptyCommands")}</div>}
            >
              <For each={slashRows()}>
                {(item) => (
                  <div class="flex flex-col">
                    <Show when={item.showGroup}>
                      <div class="px-2 pt-1.5 pb-1 text-11-medium uppercase tracking-[0.08em] text-text-weak">
                        {item.category}
                      </div>
                    </Show>
                    <button
                      data-slash-id={item.cmd.id}
                      classList={{
                        "w-full flex items-center justify-between gap-4 rounded-md px-2 py-1": true,
                        "bg-surface-raised-base-hover": props.slashActive === item.cmd.id,
                      }}
                      onClick={() => props.onSlashSelect(item.cmd)}
                      onMouseEnter={() => props.setSlashActive(item.cmd.id)}
                    >
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="text-14-regular text-text-strong whitespace-nowrap">/{item.cmd.trigger}</span>
                        <Show when={item.cmd.description}>
                          <span class="text-14-regular text-text-weak truncate">{item.cmd.description}</span>
                        </Show>
                      </div>
                      <div class="flex items-center gap-2 shrink-0">
                        <Show when={item.cmd.type === "custom" && item.cmd.source !== "command"}>
                          <span class="text-11-regular text-text-subtle px-1.5 py-0.5 bg-surface-base rounded">
                            {item.cmd.source === "skill"
                              ? props.t("prompt.slash.badge.skill")
                              : item.cmd.source === "mcp"
                                ? props.t("prompt.slash.badge.mcp")
                                : props.t("prompt.slash.badge.custom")}
                          </span>
                        </Show>
                        <Show when={props.commandKeybind(item.cmd.id)}>
                          <span class="text-12-regular text-text-subtle">{props.commandKeybind(item.cmd.id)}</span>
                        </Show>
                      </div>
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </Match>
        </Switch>
      </div>
    </Show>
  )
}
