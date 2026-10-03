import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force"
import type { SimulationLinkDatum } from "d3-force"
import type { WikiGraphNodeKind } from "@ax-code/ax-wiki/graph"

/** DOM-free three-lane force layout for the evidence map. Runs headless under Node. */
export const LAYOUT_WORLD = { width: 900, height: 600 } as const
export const LAYOUT_LIMITS = { maxTicks: 300, minRadius: 6, maxRadius: 18 } as const
export const LAYOUT_LANES: Record<WikiGraphNodeKind, number> = {
  page: LAYOUT_WORLD.width * 0.25,
  symbol: LAYOUT_WORLD.width * 0.5,
  source: LAYOUT_WORLD.width * 0.75,
} as const

export type LayoutNode = {
  id: string
  kind: WikiGraphNodeKind
  /** Incident edges in this snapshot (visible degree), the only honest size input. */
  degree: number
  radius: number
  x: number
  y: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

export type LayoutLink = SimulationLinkDatum<LayoutNode> & { from: string; to: string }

/** Present only on radial layouts; the force layout leaves it undefined. */
export type RadialMeta = {
  cx: number
  cy: number
  /** Angle in radians from the +x axis, clockwise on screen, for every node. */
  angles: ReadonlyMap<string, number>
  /** child id -> primary parent id. Every other edge is a cross link. */
  treeParent: ReadonlyMap<string, string>
}

export type ForceLayout = {
  radial?: RadialMeta
  nodes: LayoutNode[]
  links: LayoutLink[]
  byId: ReadonlyMap<string, LayoutNode>
  stop(): void
  /** Reheat a settled simulation (e.g. after a drag); resets the tick budget. */
  reheat(alpha?: number): void
}

/** Node radius from visible degree; recorded totals must never size the drawing. */
export function layoutRadius(degree: number): number {
  const safe = Number.isSafeInteger(degree) && degree > 0 ? degree : 0
  return Math.min(LAYOUT_LIMITS.maxRadius, LAYOUT_LIMITS.minRadius + 3 * Math.sqrt(safe))
}

function seedPositions(nodes: LayoutNode[]): void {
  const lanes: Record<WikiGraphNodeKind, number> = { page: 0, source: 0, symbol: 0 }
  for (const node of nodes) lanes[node.kind]++
  const cursor: Record<WikiGraphNodeKind, number> = { page: 0, source: 0, symbol: 0 }
  for (const node of nodes) {
    const total = lanes[node.kind]
    const index = cursor[node.kind]++
    node.x = LAYOUT_LANES[node.kind]
    node.y = total <= 1 ? LAYOUT_WORLD.height / 2 : 60 + ((index + 0.5) * (LAYOUT_WORLD.height - 120)) / total
  }
}

export function createForceLayout(
  input: {
    nodes: ReadonlyArray<{ id: string; kind: WikiGraphNodeKind }>
    edges: ReadonlyArray<{ from: string; to: string }>
  },
  options: {
    reducedMotion: boolean
    onTick?: () => void
    onEnd?: () => void
  },
): ForceLayout {
  const degree = new Map<string, number>()
  for (const edge of input.edges) {
    if (edge.from === edge.to) continue
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }
  const nodes: LayoutNode[] = input.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    degree: degree.get(node.id) ?? 0,
    radius: 0,
    x: 0,
    y: 0,
  }))
  for (const node of nodes) node.radius = layoutRadius(node.degree)
  seedPositions(nodes)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const links: LayoutLink[] = input.edges
    .filter((edge) => edge.from !== edge.to && byId.has(edge.from) && byId.has(edge.to))
    .map((edge) => ({ source: edge.from, target: edge.to, from: edge.from, to: edge.to }))

  const simulation = forceSimulation(nodes)
    // Lanes stay stronger than the links so the picture reads left to right:
    // wiki pages, the symbols they mention, then the files those pages cite.
    .force("lane", forceX<LayoutNode>((node) => LAYOUT_LANES[node.kind]).strength(1.1))
    .force("gravity", forceY<LayoutNode>(LAYOUT_WORLD.height / 2).strength(0.08))
    .force(
      "link",
      forceLink<LayoutNode, LayoutLink>(links)
        .id((node) => node.id)
        .distance(80)
        .strength(0.25),
    )
    .force("charge", forceManyBody<LayoutNode>().strength(-120))
    .force(
      "collide",
      forceCollide<LayoutNode>()
        .radius((node) => node.radius + 10)
        .iterations(2),
    )
    .force("center", forceCenter(LAYOUT_WORLD.width / 2, LAYOUT_WORLD.height / 2))
    .alphaDecay(0.04)

  let ended = false
  let ticks = 0
  const finish = () => {
    if (ended) return
    ended = true
    simulation.stop()
    options.onEnd?.()
  }
  const runSync = (alpha: number) => {
    simulation.stop()
    simulation.alpha(alpha)
    for (let tick = 0; tick < LAYOUT_LIMITS.maxTicks && simulation.alpha() > simulation.alphaMin(); tick++)
      simulation.tick()
    finish()
  }

  if (options.reducedMotion) {
    runSync(1)
  } else {
    simulation.on("tick", () => {
      ticks++
      if (ticks >= LAYOUT_LIMITS.maxTicks) finish()
      else options.onTick?.()
    })
    simulation.on("end", finish)
  }

  return {
    nodes,
    links,
    byId,
    stop: () => simulation.stop(),
    reheat: (alpha = 0.3) => {
      if (options.reducedMotion) {
        runSync(alpha)
        return
      }
      ended = false
      ticks = 0
      simulation.alpha(alpha).restart()
    },
  }
}
