/**
 * Settlement scoring. The original site let you click corners but never told
 * you whether a corner was any good; this works that out.
 */
import { PORTS, VERTEX_NEIGHBOURS, VERTICES, portsByVertex, portsFor } from './geometry'
import type { Game, PortType, ResourceType } from './types'

/** Dots on the number token — ways to roll it out of 36. */
export function pips(number: number): number {
  if (number < 2 || number > 12 || number === 7) return 0
  return 6 - Math.abs(number - 7)
}

export interface VertexReport {
  vertex: number
  /** Total pips across the touching tiles — the headline number. */
  pips: number
  /** Pips broken down by resource. */
  byResource: Partial<Record<ResourceType, number>>
  /** How many distinct resources this corner produces. */
  variety: number
  port: PortType | null
  /** 0-100, scaled against the best corner on this board. */
  rating: number
}

/** Corners that are still legal to build on, given what's already placed. */
export function legalVertices(locs: number[]): Set<number> {
  const taken = new Set(locs)
  const blocked = new Set(taken)
  for (const loc of locs) {
    for (const n of VERTEX_NEIGHBOURS[loc]) blocked.add(n)
  }
  return new Set(VERTICES.map((v) => v.index).filter((i) => !blocked.has(i)))
}

export function analyseBoard(game: Game): VertexReport[] {
  const portsAt = portsByVertex(portsFor(game.portShifts))
  const raw = VERTICES.map((vertex) => {
    const byResource: Partial<Record<ResourceType, number>> = {}
    let total = 0

    for (const tileIndex of vertex.tiles) {
      const tile = game.tiles[tileIndex]
      if (!tile || tile.type === 'desert') continue
      const value = pips(tile.number)
      byResource[tile.type] = (byResource[tile.type] ?? 0) + value
      total += value
    }

    const portIndex = portsAt[vertex.index][0]
    return {
      vertex: vertex.index,
      pips: total,
      byResource,
      variety: Object.keys(byResource).length,
      port: portIndex === undefined ? null : game.ports[portIndex] ?? null,
      rating: 0,
    }
  })

  const best = Math.max(...raw.map((r) => r.pips), 1)
  for (const report of raw) {
    report.rating = Math.round((report.pips / best) * 100)
  }
  return raw
}

/** Resource totals a player would collect from all of their settlements. */
export function playerTotals(reports: VertexReport[], vertices: number[]) {
  const totals: Partial<Record<ResourceType, number>> = {}
  let pipTotal = 0
  const ports = new Set<PortType>()

  for (const v of vertices) {
    const report = reports[v]
    if (!report) continue
    pipTotal += report.pips
    for (const [resource, value] of Object.entries(report.byResource)) {
      totals[resource as ResourceType] = (totals[resource as ResourceType] ?? 0) + value
    }
    if (report.port) ports.add(report.port)
  }

  return { totals, pipTotal, ports: [...ports] }
}

/** Which tiles a port sits beside, for hover highlighting. */
export const PORT_TILES = PORTS.map((p) => p.tile)
