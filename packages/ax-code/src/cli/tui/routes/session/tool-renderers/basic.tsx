import { useLanguage } from "@tui/context/language"
import { createMemo, Show } from "solid-js"
import type { GlobTool } from "@/tool/glob"
import type { GrepTool } from "@/tool/grep"
import type { ListTool } from "@/tool/ls"
import type { WebFetchTool } from "@/tool/webfetch"
import type { SkillTool } from "@/tool/skill"
import { normalize } from "../format"
import { InlineTool, type ToolProps } from "./primitives"

export function Glob(props: ToolProps<typeof GlobTool>) {
  const uiText = useLanguage().t

  return (
    <InlineTool icon="✱" pending="Finding files..." complete={props.input.pattern} part={props.part}>
      {uiText("ui.glob")}
      {props.input.pattern}"{" "}
      <Show when={props.input.path}>
        {uiText("ui.in")} {normalize(props.input.path)}{" "}
      </Show>
      <Show when={props.metadata.count}>
        ({props.metadata.count} {props.metadata.count === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

export function Grep(props: ToolProps<typeof GrepTool>) {
  const uiText = useLanguage().t

  return (
    <InlineTool icon="✱" pending="Searching content..." complete={props.input.pattern} part={props.part}>
      {uiText("ui.grep")}
      {props.input.pattern}"{" "}
      <Show when={props.input.path}>
        {uiText("ui.in")} {normalize(props.input.path)}{" "}
      </Show>
      <Show when={props.metadata.matches}>
        ({props.metadata.matches} {props.metadata.matches === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

export function List(props: ToolProps<typeof ListTool>) {
  const uiText = useLanguage().t

  const dir = createMemo(() => {
    if (props.input.path) {
      return normalize(props.input.path)
    }
    return ""
  })
  return (
    <InlineTool icon="→" pending="Listing directory..." complete={props.input.path !== undefined} part={props.part}>
      {uiText("ui.list")} {dir()}
    </InlineTool>
  )
}

export function WebFetch(props: ToolProps<typeof WebFetchTool>) {
  const uiText = useLanguage().t

  return (
    <InlineTool icon="%" pending="Fetching from the web..." complete={(props.input as any).url} part={props.part}>
      {uiText("ui.webfetch")} {(props.input as any).url}
    </InlineTool>
  )
}

export function CodeSearch(props: ToolProps<any>) {
  const uiText = useLanguage().t

  const input = props.input as any
  const metadata = props.metadata as any
  return (
    <InlineTool icon="◇" pending="Searching code..." complete={input.query} part={props.part}>
      {uiText("ui.codeSearch")}
      {input.query}"{" "}
      <Show when={metadata.results}>
        ({metadata.results} {uiText("ui.results")}
      </Show>
    </InlineTool>
  )
}

export function WebSearch(props: ToolProps<any>) {
  const uiText = useLanguage().t

  const input = props.input as any
  const metadata = props.metadata as any
  return (
    <InlineTool icon="◈" pending="Searching web..." complete={input.query} part={props.part}>
      {uiText("ui.webSearch")}
      {input.query}"{" "}
      <Show when={metadata.numResults}>
        ({metadata.numResults} {uiText("ui.results")}
      </Show>
    </InlineTool>
  )
}

export function Skill(props: ToolProps<typeof SkillTool>) {
  return (
    <InlineTool
      icon="→"
      pending={props.input.query !== undefined ? "Searching skills..." : "Loading skill..."}
      complete={props.input.query !== undefined || props.input.name !== undefined}
      part={props.part}
    >
      {props.input.query !== undefined ? `Skill search "${props.input.query}"` : `Skill "${props.input.name}"`}
    </InlineTool>
  )
}
