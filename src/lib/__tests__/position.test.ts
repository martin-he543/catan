import { describe, expect, it } from 'vitest'
import { HEX_CENTERS, VERTEX_NEIGHBOURS, VERTICES } from '../geometry'
import type { Edge, ParseIssue } from '../notation'
import {
  emptySeat,
  formatPosition,
  longestRoad,
  parsePosition,
  placeBuilding,
  positionFromUrl,
  positionProblems,
  positionToUrl,
  standings,
  toggleRoad,
  type SeatPieces,
} from '../position'

const edge = (a: number, b: number): Edge => (a < b ? [a, b] : [b, a])

/**
 * The zigzag of corners along the top edge of the middle row (C1-C5): eleven
 * corners joined by ten roads, far longer than any test needs.
 */
const RIDGE = VERTICES.filter(
  (v) => v.y < HEX_CENTERS[9].y - 0.1 && v.y > HEX_CENTERS[4].y && v.tiles.some((t) => t >= 7 && t <= 11),
).sort((a, b) => a.x - b.x).map((v) => v.index)

/** A simple path of `length` roads, starting `from` corners along the ridge. */
function trail(from: number, length: number): { corners: number[]; roads: Edge[] } {
  const corners = RIDGE.slice(from, from + length + 1)
  if (corners.length !== length + 1) throw new Error('trail ran out of board')
  const roads = corners.slice(1).map((c, i) => edge(corners[i], c))
  roads.forEach(([a, b]) => expect(VERTEX_NEIGHBOURS[a]).toContain(b))
  return { corners, roads }
}

const seats = (n: number) => Array.from({ length: n }, emptySeat)

describe('longestRoad', () => {
  it('counts a straight run', () => {
    expect(longestRoad(trail(0, 6).roads, new Set())).toBe(6)
  })

  it('takes the longest branch of a fork, not the total', () => {
    const { corners, roads } = trail(2, 4)
    // A one-road spur off the middle corner.
    const middle = corners[2]
    const spur = VERTEX_NEIGHBOURS[middle].find((n) => !corners.includes(n))!
    expect(longestRoad([...roads, edge(middle, spur)], new Set())).toBe(4)
  })

  it('is cut by an opponent building part-way along', () => {
    const { corners, roads } = trail(0, 6)
    expect(longestRoad(roads, new Set([corners[2]]))).toBe(4)
  })

  it('still counts roads running up to an opponent at the end', () => {
    const { corners, roads } = trail(0, 5)
    expect(longestRoad(roads, new Set([corners[5]]))).toBe(5)
  })

  it('goes all the way round a loop', () => {
    // The six corners of the centre hex, clockwise.
    const c = HEX_CENTERS[9]
    const ring = VERTICES.filter((v) => v.tiles.includes(9))
      .sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x))
      .map((v) => v.index)
    const roads = ring.map((v, i) => edge(v, ring[(i + 1) % 6]))
    roads.forEach(([a, b]) => expect(VERTEX_NEIGHBOURS[a]).toContain(b))
    expect(longestRoad(roads, new Set())).toBe(6)
  })

  it('ignores duplicated roads', () => {
    const { roads } = trail(0, 3)
    expect(longestRoad([...roads, roads[0]], new Set())).toBe(3)
  })
})

describe('standings', () => {
  it('scores settlements, cities and cards', () => {
    const s = seats(2)
    s[0] = { ...s[0], settlements: [0, 10], cities: [30], victoryCards: 2 }
    const { scores } = standings(s)
    expect(scores[0].publicPoints).toBe(4)
    expect(scores[0].points).toBe(6)
    expect(scores[1].points).toBe(0)
  })

  it('gives longest road at five and largest army at three', () => {
    const s = seats(2)
    s[0] = { ...s[0], settlements: [0], roads: trail(0, 5).roads }
    s[1] = { ...s[1], knights: 3 }
    const { scores } = standings(s)
    expect(scores[0].longestRoad).toBe(true)
    expect(scores[0].points).toBe(3)
    expect(scores[1].largestArmy).toBe(true)
    expect(scores[1].points).toBe(2)
  })

  it('withholds the awards below their minimum', () => {
    const s = seats(2)
    s[0] = { ...s[0], roads: trail(0, 4).roads, knights: 2 }
    const { scores } = standings(s)
    expect(scores[0].longestRoad).toBe(false)
    expect(scores[0].largestArmy).toBe(false)
  })

  it('reports a tie until someone is recorded as the holder', () => {
    const s = seats(3)
    s[0] = { ...s[0], knights: 4 }
    s[2] = { ...s[2], knights: 4 }
    expect(standings(s).armyTie).toEqual([0, 2])
    expect(standings(s).scores.some((x) => x.largestArmy)).toBe(false)

    s[2] = { ...s[2], claims: ['LA'] }
    const settled = standings(s)
    expect(settled.armyTie).toEqual([])
    expect(settled.scores[2].largestArmy).toBe(true)
  })

  it('ignores a claim from a seat that has been overtaken', () => {
    const s = seats(2)
    s[0] = { ...s[0], knights: 3, claims: ['LA'] }
    s[1] = { ...s[1], knights: 5 }
    expect(standings(s).scores[1].largestArmy).toBe(true)
  })

  it("lets an opponent's settlement break a road", () => {
    const { corners, roads } = trail(0, 6)
    const s = seats(2)
    s[0] = { ...s[0], settlements: [corners[0]], roads }
    expect(standings(s).scores[0].roadLength).toBe(6)
    s[1] = { ...s[1], settlements: [corners[3]] }
    expect(standings(s).scores[0].roadLength).toBe(3)
  })
})

describe('editing', () => {
  it('takes a corner from another seat', () => {
    let s = placeBuilding(seats(2), 0, 5, 'settlement')
    s = placeBuilding(s, 1, 5, 'city')
    expect(s[0].settlements).toEqual([])
    expect(s[1].cities).toEqual([5])
  })

  it('steps your own piece back when clicked again', () => {
    let s = placeBuilding(seats(2), 0, 5, 'city')
    s = placeBuilding(s, 0, 5, 'city')
    expect(s[0]).toMatchObject({ cities: [], settlements: [5] })
    s = placeBuilding(s, 0, 5, 'settlement')
    expect(s[0].settlements).toEqual([])
  })

  it('toggles and steals roads', () => {
    const road = trail(0, 1).roads[0]
    let s = toggleRoad(seats(2), 0, road)
    expect(s[0].roads).toEqual([road])
    s = toggleRoad(s, 1, road)
    expect(s[0].roads).toEqual([])
    expect(s[1].roads).toEqual([road])
    s = toggleRoad(s, 1, road)
    expect(s[1].roads).toEqual([])
  })
})

describe('positionProblems', () => {
  const names = ['Red', 'Blue']

  it('is quiet for a legal position', () => {
    const s = seats(2)
    const { corners, roads } = trail(0, 2)
    s[0] = { ...s[0], settlements: [corners[0]], roads }
    expect(positionProblems(s, names)).toEqual([])
  })

  it('flags loose roads and crowded corners', () => {
    const s = seats(2)
    const { corners, roads } = trail(0, 2)
    s[0] = { ...s[0], settlements: [corners[0], corners[1]] }
    s[1] = { ...s[1], roads }
    const problems = positionProblems(s, names)
    expect(problems.some((p) => p.includes('too close'))).toBe(true)
    expect(problems.some((p) => p.startsWith("Blue's roads"))).toBe(true)
  })

  it('flags more pieces than the box holds', () => {
    const s = seats(2)
    s[0] = { ...s[0], knights: 10 }
    s[1] = { ...s[1], knights: 5, victoryCards: 6 }
    expect(positionProblems(s, names)).toHaveLength(2)
  })
})

describe('position notation', () => {
  const sample = (): SeatPieces[] => {
    const s = seats(3)
    const { roads } = trail(0, 2)
    s[0] = { ...s[0], settlements: [0], cities: [20], roads, knights: 2, victoryCards: 1 }
    s[1] = { ...s[1], settlements: [40], claims: ['LA'] }
    return s
  }

  it('writes seats in order with - for an empty one', () => {
    const text = formatPosition(sample())
    expect(text.split(' / ')).toHaveLength(3)
    expect(text).toMatch(/^Sa1 C\w+ R\w+ R\w+ K2 V1 \/ S\w+ \^LA \/ -$/)
  })

  it('round-trips', () => {
    const text = formatPosition(sample())
    const issues: ParseIssue[] = []
    expect(formatPosition(parsePosition(text, issues))).toBe(text)
    expect(issues).toEqual([])
  })

  it('round-trips through the URL form', () => {
    const text = formatPosition(sample())
    const url = positionToUrl(text)
    expect(url).not.toMatch(/[\s/]/)
    expect(formatPosition(parsePosition(positionFromUrl(url)))).toBe(text)
  })

  it('reports tokens it cannot place', () => {
    const issues: ParseIssue[] = []
    const parsed = parsePosition('Sa1 Zq9 / XC3', issues)
    expect(parsed[0].settlements).toEqual([0])
    expect(issues).toHaveLength(2)
  })

  it('gives a contested corner to the later seat', () => {
    const parsed = parsePosition('Sa1 / Ca1')
    expect(parsed[0].settlements).toEqual([])
    expect(parsed[1].cities).toEqual([0])
  })
})
