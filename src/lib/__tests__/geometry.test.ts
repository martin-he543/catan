import { describe, expect, it } from 'vitest'
import {
  HEX_CENTERS,
  COAST,
  PORTS,
  canShiftPort,
  portShiftsValid,
  portsFor,
  rotatePorts,
  shiftPort,
  SEA_CENTERS,
  TILE_NEIGHBOURS,
  VERTEX_NEIGHBOURS,
  VERTICES,
} from '../geometry'

/** The adjacency table the original site hard-coded, used here as an oracle. */
const ORIGINAL_ADJACENCY: Record<number, number[]> = {
  0: [1, 3, 4], 1: [0, 2, 4, 5], 2: [1, 5, 6], 3: [0, 4, 7, 8],
  4: [0, 1, 3, 5, 8, 9], 5: [1, 2, 4, 6, 9, 10], 6: [2, 5, 10, 11],
  7: [3, 8, 12], 8: [3, 4, 7, 9, 12, 13], 9: [4, 5, 8, 10, 13, 14],
  10: [5, 6, 9, 11, 14, 15], 11: [6, 10, 15], 12: [7, 8, 13, 16],
  13: [8, 9, 12, 14, 16, 17], 14: [9, 10, 13, 15, 17, 18],
  15: [10, 11, 14, 18], 16: [12, 13, 17], 17: [13, 14, 16, 18], 18: [14, 15, 17],
}

const sorted = (a: number[]) => [...a].sort((x, y) => x - y)

describe('board geometry', () => {
  it('has 19 land hexes and 18 sea hexes', () => {
    expect(HEX_CENTERS).toHaveLength(19)
    expect(SEA_CENTERS).toHaveLength(18)
  })

  it('has 54 settlement corners', () => {
    expect(VERTICES).toHaveLength(54)
  })

  it('derives the same tile adjacency the original hard-coded', () => {
    for (const [key, expected] of Object.entries(ORIGINAL_ADJACENCY)) {
      expect(sorted(TILE_NEIGHBOURS[Number(key)])).toEqual(sorted(expected))
    }
  })

  it('numbers corners left-to-right, top-to-bottom in rows of 3/4/4/5/5/6/6/5/5/4/4/3', () => {
    const counts: number[] = []
    let lastY = Number.NEGATIVE_INFINITY
    for (const v of VERTICES) {
      if (Math.abs(v.y - lastY) > 1e-6) {
        counts.push(0)
        lastY = v.y
      }
      counts[counts.length - 1]++
    }
    expect(counts).toEqual([3, 4, 4, 5, 5, 6, 6, 5, 5, 4, 4, 3])
  })

  it('gives every corner 1-3 touching tiles and 2-3 neighbouring corners', () => {
    for (const v of VERTICES) {
      expect(v.tiles.length).toBeGreaterThanOrEqual(1)
      expect(v.tiles.length).toBeLessThanOrEqual(3)
      expect(VERTEX_NEIGHBOURS[v.index].length).toBeGreaterThanOrEqual(2)
      expect(VERTEX_NEIGHBOURS[v.index].length).toBeLessThanOrEqual(3)
    }
  })

  it('makes corner adjacency symmetric', () => {
    VERTEX_NEIGHBOURS.forEach((neighbours, i) => {
      for (const n of neighbours) expect(VERTEX_NEIGHBOURS[n]).toContain(i)
    })
  })

  it('places 9 ports, each on a distinct pair of coastal corners', () => {
    expect(PORTS).toHaveLength(9)
    const seen = new Set<string>()
    for (const port of PORTS) {
      const key = sorted(port.vertices).join('-')
      expect(seen.has(key)).toBe(false)
      seen.add(key)
      // Both corners of a port edge must be real settlement corners.
      for (const v of port.vertices) expect(VERTICES[v]).toBeDefined()
    }
  })
})

describe('port nudges', () => {
  it('finds all 30 shoreline edges, and leaves the standard layout untouched', () => {
    expect(COAST).toHaveLength(30)
    expect(new Set(COAST.map((e) => `${e.tile}-${e.dir}`)).size).toBe(30)
    expect(portsFor()).toBe(PORTS)
    expect(portsFor(PORTS.map(() => 0))).toBe(PORTS)
  })

  it('moves a port to the neighbouring shore edge, sharing one corner with where it was', () => {
    for (let i = 0; i < PORTS.length; i++) {
      for (const delta of [-1, 1]) {
        if (!canShiftPort(undefined, i, delta)) continue
        const moved = portsFor(shiftPort(undefined, i, delta))[i]
        expect(moved.coast).toBe((PORTS[i].coast + delta + 30) % 30)
        const shared = moved.vertices.filter((v) => PORTS[i].vertices.includes(v))
        expect(shared).toHaveLength(1)
      }
    }
  })

  it('never lets two ports share a corner, and caps a nudge at one edge', () => {
    let shifts = shiftPort(undefined, 0, 1)
    expect(shiftPort(shifts, 0, 1)).toEqual(shifts)
    shifts = shiftPort(shifts, 1, -1)
    expect(portShiftsValid(shifts)).toBe(true)
    const ports = portsFor(shifts)
    const corners = ports.flatMap((p) => p.vertices)
    expect(new Set(corners).size).toBe(corners.length)
  })
})

describe('rotating every port', () => {
  it('moves all nine ports one edge together, at most one edge each way', () => {
    const right = rotatePorts(undefined, 1)
    expect(right).toEqual(PORTS.map(() => 1))
    expect(portShiftsValid(right)).toBe(true)
    expect(rotatePorts(right, 1)).toEqual(right)
    expect(rotatePorts(right, -1)).toBeUndefined()
    expect(rotatePorts(rotatePorts(undefined, -1), -1)).toEqual(PORTS.map(() => -1))
    portsFor(right).forEach((p, i) => {
      expect(p.coast).toBe((PORTS[i].coast + 1) % COAST.length)
    })
  })
})
