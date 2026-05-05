export type SessionTreeEdge = {
  sessionId: string
  parentSessionId: string | null
  [key: string]: unknown
}

export type SessionUsageRow = {
  sessionId: string
  totalTokens: number
  totalCostUsd: number | null
}

function mergeUsdTotals(base: number | null, next: number | null) {
  if (base == null || next == null) {
    return null
  }

  return base + next
}

export function rollupSessionTree(edges: SessionTreeEdge[], usage: SessionUsageRow[]) {
  const childrenByParent = new Map<string, string[]>()
  const edgeBySessionId = new Map(edges.map((edge) => [edge.sessionId, edge]))
  const usageBySessionId = new Map(usage.map((row) => [row.sessionId, { ...row }]))
  const visited = new Set<string>()

  for (const edge of edges) {
    if (!edge.parentSessionId) {
      continue
    }

    const children = childrenByParent.get(edge.parentSessionId) ?? []
    children.push(edge.sessionId)
    childrenByParent.set(edge.parentSessionId, children)
  }

  function visit(sessionId: string): SessionUsageRow {
    if (visited.has(sessionId)) {
      return usageBySessionId.get(sessionId) ?? {
        sessionId,
        totalTokens: 0,
        totalCostUsd: 0,
      }
    }

    visited.add(sessionId)

    const base = usageBySessionId.get(sessionId) ?? {
      sessionId,
      totalTokens: 0,
      totalCostUsd: 0,
    }

    for (const childSessionId of childrenByParent.get(sessionId) ?? []) {
      const child = visit(childSessionId)
      base.totalTokens += child.totalTokens
      base.totalCostUsd = mergeUsdTotals(base.totalCostUsd, child.totalCostUsd)
    }

    usageBySessionId.set(sessionId, base)
    return base
  }

  for (const edge of edges) {
    visit(edge.sessionId)
  }

  return [...usageBySessionId.values()].map((row) => ({
    ...edgeBySessionId.get(row.sessionId),
    ...row,
  }))
}
