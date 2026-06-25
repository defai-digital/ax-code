import type { JSX } from "@ax-code/opentui-solid"
import { sessionToolRendererKey, type SessionToolRendererKey } from "../tool-rendering"
import { CodeSearch, Glob, Grep, List, Skill, WebFetch, WebSearch } from "./basic"
import { RefactorPlan, RefactorApply, ImpactAnalyze, DedupScan } from "./dre"
import { ApplyPatch, Bash, Edit, Write } from "./file-edits"
import { GenericTool } from "./generic"
import { BlockTool, InlineTool, type ToolProps } from "./primitives"
import { Question, Read, TodoWrite } from "./session"
import { Task } from "./task"

export { BlockTool, InlineTool, type ToolProps }

export type ToolRendererComponent = (props: ToolProps<any>) => JSX.Element

const TOOL_RENDERER_COMPONENTS: Record<SessionToolRendererKey, ToolRendererComponent> = {
  bash: (props) => <Bash {...props} />,
  glob: (props) => <Glob {...props} />,
  read: (props) => <Read {...props} />,
  grep: (props) => <Grep {...props} />,
  list: (props) => <List {...props} />,
  webfetch: (props) => <WebFetch {...props} />,
  codesearch: (props) => <CodeSearch {...props} />,
  websearch: (props) => <WebSearch {...props} />,
  write: (props) => <Write {...props} />,
  edit: (props) => <Edit {...props} />,
  task: (props) => <Task {...props} />,
  apply_patch: (props) => <ApplyPatch {...props} />,
  todowrite: (props) => <TodoWrite {...props} />,
  question: (props) => <Question {...props} />,
  skill: (props) => <Skill {...props} />,
  refactor_plan: (props) => <RefactorPlan {...props} />,
  refactor_apply: (props) => <RefactorApply {...props} />,
  impact_analyze: (props) => <ImpactAnalyze {...props} />,
  dedup_scan: (props) => <DedupScan {...props} />,
  generic: (props) => <GenericTool {...props} />,
}

export function toolRendererComponent(tool: string): ToolRendererComponent {
  return TOOL_RENDERER_COMPONENTS[sessionToolRendererKey(tool)]
}
