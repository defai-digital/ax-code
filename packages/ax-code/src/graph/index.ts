import { EventQuery } from "../replay/query"
import type { ReplayEvent } from "../replay/event"
import { Risk } from "../risk/score"
import { extractTarget, truncate } from "../audit/report"
import type { SessionID } from "../session/schema"

export namespace ExecutionGraph {
  export type NodeType = "session" | "step" | "tool_call" | "tool_result" | "agent_route" | "llm" | "error"

  export type NodeStatus = "ok" | "error" | "pending"

  export type Node = {
    id: string
    type: NodeType
    label: string
    timestamp: number
    duration?: number
    status?: NodeStatus
    stepIndex?: number
    callID?: string
    tool?: string
    agent?: string
    confidence?: number
    tokens?: { input: number; output: number }
  }

  export type EdgeType = "sequence" | "call_result" | "step_contains"

  export type Edge = {
    from: string
    to: string
    type: EdgeType
  }

  export type Metadata = {
    duration: number
    tokens: { input: number; output: number }
    risk: { level: string; score: number; summary: string }
    agents: string[]
    tools: string[]
    steps: number
    errors: number
  }

  export type Graph = {
    sessionID: string
    nodes: Node[]
    edges: Edge[]
    metadata: Metadata
  }

  export function build(sessionID: SessionID): Graph {
    const rows = EventQuery.bySessionWithTimestamp(sessionID)
    if (rows.length === 0) {
      return {
        sessionID,
        nodes: [],
        edges: [],
        metadata: {
          duration: 0,
          tokens: { input: 0, output: 0 },
          risk: { level: "LOW", score: 0, summary: "no events" },
          agents: [],
          tools: [],
          steps: 0,
          errors: 0,
        },
      }
    }

    const nodes: Node[] = []
    const edges: Edge[] = []
    const stepNodes = new Map<number, Node>()
    const pending = new Map<string, string>() // callID -> node ID
    const agents = new Set<string>()
    const tools = new Set<string>()
    let prevID: string | undefined
    let currentStepID: string | undefined
    let totalInput = 0
    let totalOutput = 0
    let stepCount = 0
    let errorCount = 0

    for (let i = 0; i < rows.length; i++) {
      const { event_data: event, time_created: ts } = rows[i]
      const e = event as ReplayEvent & Record<string, unknown>
      let node: Node | undefined

      switch (e.type) {
        case "session.start": {
          const agent = e.agent as string
          agents.add(agent)
          node = {
            id: "session-start",
            type: "session",
            label: `Start (${truncate(agent, 20)})`,
            timestamp: ts,
            agent,
          }
          break
        }

        case "session.end": {
          node = {
            id: "session-end",
            type: "session",
            label: `End (${e.reason})`,
            timestamp: ts,
          }
          break
        }

        case "step.start": {
          const idx = e.stepIndex as number
          stepCount++
          node = {
            id: `step-${idx}`,
            type: "step",
            label: `Step #${idx}`,
            timestamp: ts,
            stepIndex: idx,
          }
          stepNodes.set(idx, node)
          currentStepID = node.id
          break
        }

        case "step.finish": {
          const idx = e.stepIndex as number
          const existing = stepNodes.get(idx)
          if (existing) {
            existing.duration = ts - existing.timestamp
            const tokens = e.tokens as { input: number; output: number }
            existing.tokens = { input: tokens.input, output: tokens.output }
          }
          currentStepID = undefined
          // No node created — enriches existing step node
          break
        }

        case "tool.call": {
          const tool = e.tool as string
          const callID = e.callID as string
          const input = (e.input ?? {}) as Record<string, unknown>
          const target = extractTarget(tool, input)
          tools.add(tool)
          node = {
            id: `call-${callID}`,
            type: "tool_call",
            label: target ? `${tool}: ${truncate(target, 40)}` : tool,
            timestamp: ts,
            callID,
            tool,
          }
          pending.set(callID, node.id)
          break
        }

        case "tool.result": {
          const callID = e.callID as string
          const tool = e.tool as string
          const status = e.status as "completed" | "error"
          const dur = e.durationMs as number
          node = {
            id: `result-${callID}`,
            type: "tool_result",
            label: `${tool} ${status === "error" ? "ERR" : "ok"}`,
            timestamp: ts,
            duration: dur,
            status: status === "error" ? "error" : "ok",
            callID,
            tool,
          }
          const callNodeID = pending.get(callID)
          if (callNodeID) {
            edges.push({ from: callNodeID, to: node.id, type: "call_result" })
            pending.delete(callID)
          }
          break
        }

        case "llm.response": {
          const tokens = e.tokens as { input: number; output: number }
          const latency = e.latencyMs as number
          totalInput += tokens.input
          totalOutput += tokens.output
          node = {
            id: `llm-${i}`,
            type: "llm",
            label: `LLM ${e.finishReason} (${latency}ms)`,
            timestamp: ts,
            duration: latency,
            tokens: { input: tokens.input, output: tokens.output },
          }
          break
        }

        case "agent.route": {
          const from = e.fromAgent as string
          const to = e.toAgent as string
          const conf = e.confidence as number
          agents.add(from)
          agents.add(to)
          node = {
            id: `route-${i}`,
            type: "agent_route",
            label: `${from} \u2192 ${to}`,
            timestamp: ts,
            agent: to,
            confidence: conf,
          }
          break
        }

        case "error": {
          errorCount++
          const msg = truncate(String(e.message), 50)
          node = {
            id: `error-${i}`,
            type: "error",
            label: `${e.errorType}: ${msg}`,
            timestamp: ts,
            status: "error",
          }
          break
        }

        // Skip low-signal events
        default:
          break
      }

      if (!node) continue

      nodes.push(node)

      // Sequence edge
      if (prevID) {
        edges.push({ from: prevID, to: node.id, type: "sequence" })
      }
      prevID = node.id

      // Step contains edge
      if (currentStepID && node.type !== "step" && node.type !== "session") {
        edges.push({ from: currentStepID, to: node.id, type: "step_contains" })
      }
    }

    // Mark interrupted calls
    for (const [, nodeID] of pending) {
      const node = nodes.find((n) => n.id === nodeID)
      if (node) node.status = "pending"
    }

    const risk = Risk.fromSession(sessionID)
    const first = rows[0].time_created
    const last = rows[rows.length - 1].time_created

    return {
      sessionID,
      nodes,
      edges,
      metadata: {
        duration: last - first,
        tokens: { input: totalInput, output: totalOutput },
        risk: { level: risk.level, score: risk.score, summary: risk.summary },
        agents: [...agents].sort(),
        tools: [...tools].sort(),
        steps: stepCount,
        errors: errorCount,
      },
    }
  }
}
