const AGENT_DISPLAY: Record<string, string> = {
  build: "Dev",
  plan: "Planner",
  react: "Reasoner",
  general: "Assistant",
  explore: "Researcher",
  scout: "Scout",
  security: "Security",
  architect: "Architect",
  debug: "Debugger",
  perf: "Perf",
  devops: "DevOps",
  test: "Tester",
  cloudops: "Cloud Ops",
  "goal-plan-writer": "Goal Plan Writer",
}

export function agentDisplay(name: string): string {
  return AGENT_DISPLAY[name] ?? name.charAt(0).toUpperCase() + name.slice(1)
}
