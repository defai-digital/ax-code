type Child = {
  id?: string
  y: number
}

type Message = {
  id: string
}

type Part = {
  type?: string
  synthetic?: boolean
  ignored?: boolean
}

export function visibleMessages(children: Child[], messages: Message[], parts: Record<string, Part[] | undefined>) {
  return children
    .filter((child) => {
      if (!child.id) return false
      if (!messages.find((msg) => msg.id === child.id)) return false
      const list = parts[child.id]
      if (!list || !Array.isArray(list)) return false
      return list.some((part) => part?.type === "text" && !part.synthetic && !part.ignored)
    })
    .sort((a, b) => a.y - b.y)
}

export function messageTarget(children: Child[], id: string | undefined) {
  if (!id) return
  return children.find((child) => child.id === id)
}

export function nextVisibleMessage(input: {
  direction: "next" | "prev"
  children: Child[]
  messages: Message[]
  parts: Record<string, Part[] | undefined>
  scrollTop: number
  offset?: number
}) {
  const visible = visibleMessages(input.children, input.messages, input.parts)
  if (visible.length === 0) return null
  const offset = input.offset ?? 10
  if (input.direction === "next") {
    return visible.find((child) => child.y > input.scrollTop + offset)?.id ?? null
  }
  return [...visible].reverse().find((child) => child.y < input.scrollTop - offset)?.id ?? null
}

export function messageScroll(input: {
  direction: "next" | "prev"
  target?: Child
  scrollTop: number
  height: number
}) {
  if (!input.target) {
    return input.direction === "next" ? input.height : -input.height
  }
  return input.target.y - input.scrollTop - 1
}
