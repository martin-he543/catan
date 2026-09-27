/**
 * Positions: a snapshot of a game in progress, rather than the moves that led
 * to it — the Catan counterpart of a chess FEN.
 *
 * A position is written as one `[Position]` tag alongside the usual board
 * header, with each seat's pieces in the same tokens a game record uses:
 *
 *   [Players "1:Ana 2:Sam 3:Kit"]
 *   [Robber "C2"]
 *   [Position "Sf3 Ch5 Rf3g3 Rg3h3 K2 / Sg2 Rg2h2 V1 ^LA / -"]
 *
 * Seats are separated by `/` in turn order, and `-` is a seat with nothing on
 * the board. On top of `S`, `C` and `R`, two counters record the cards that
 * change the score: `K2` is two knights played, `V1` one victory point card.
 * `^LR` / `^LA` note who holds an award, which only matters to settle a tie —
 * otherwise both are worked out from the pieces.
 */
import { VERTEX_NEIGHBOURS } from './geometry'
import {
  HEX_LABELS,
  VERTEX_LABELS,
  edgeLabel,
  hexIndex,
  parseAction,
  type Edge,
  type ParseIssue,
} from './notation'

export type Award = 'LR' | 'LA'

/** What each seat has in the box, per the base game. */
export const PIECE_SUPPLY = { settlements: 5, cities: 4, roads: 15 } as const
export const KNIGHT_SUPPLY = 14
export const VICTORY_CARD_SUPPLY = 5

export const LONGEST_ROAD_MIN = 5
export const LARGEST_ARMY_MIN = 3
export const AWARD_POINTS = 2
export const WINNING_POINTS = 10

export const MIN_SEATS = 2
export const MAX_SEATS = 4

export interface SeatPieces {
  settlements: number[]
  cities: number[]
  roads: Edge[]
  knights: number
  victoryCards: number
  /** Awards this seat is recorded as holding, used only to break a tie. */
  claims: Award[]
}

export const emptySeat = (): SeatPieces => ({
  settlements: [],
  cities: [],
  roads: [],
  knights: 0,
  victoryCards: 0,
  claims: [],
})

const sameEdge = (p: Edge, q: Edge) => p[0] === q[0] && p[1] === q[1]

/* ------------------------------------------------------------------ *
 * Editing
 * ------------------------------------------------------------------ */

function withoutVertex(seat: SeatPieces, vertex: number): SeatPieces {
  return {
    ...seat,
    settlements: seat.settlements.filter((v) => v !== vertex),
    cities: seat.cities.filter((v) => v !== vertex),
  }
}

function withoutEdge(seat: SeatPieces, edge: Edge): SeatPieces {
  return { ...seat, roads: seat.roads.filter((r) => !sameEdge(r, edge)) }
}

/**
 * Put a building on a corner for `seat`, taking it from whoever held it.
 * Clicking your own piece again steps it back: a city becomes a settlement,
 * a settlement is removed.
 */
export function placeBuilding(
  seats: readonly SeatPieces[],
  seat: number,
  vertex: number,
  kind: 'settlement' | 'city',
): SeatPieces[] {
  const mine = seats[seat]
  const hadSettlement = mine.settlements.includes(vertex)
  const hadCity = mine.cities.includes(vertex)

  return seats.map((s, i) => {
    const cleared = withoutVertex(s, vertex)
    if (i !== seat) return cleared
    if (kind === 'settlement') {
      return hadSettlement ? cleared : { ...cleared, settlements: [...cleared.settlements, vertex] }
    }
    return hadCity
      ? { ...cleared, settlements: [...cleared.settlements, vertex] }
      : { ...cleared, cities: [...cleared.cities, vertex] }
  })
}

/** Build a road for `seat`, or pick it back up if it was already theirs. */
export function toggleRoad(seats: readonly SeatPieces[], seat: number, edge: Edge): SeatPieces[] {
  const had = seats[seat].roads.some((r) => sameEdge(r, edge))
  return seats.map((s, i) => {
    const cleared = withoutEdge(s, edge)
    return i === seat && !had ? { ...cleared, roads: [...cleared.roads, edge] } : cleared
  })
}

export const clearVertex = (seats: readonly SeatPieces[], vertex: number) =>
  seats.map((s) => withoutVertex(s, vertex))

export const clearEdge = (seats: readonly SeatPieces[], edge: Edge) =>
  seats.map((s) => withoutEdge(s, edge))

/** Who has a building on each corner, or -1. */
export function vertexOwners(seats: readonly SeatPieces[]): number[] {
  const owners = VERTEX_LABELS.map(() => -1)
  seats.forEach((s, i) => [...s.settlements, ...s.cities].forEach((v) => (owners[v] = i)))
  return owners
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

/**
 * The longest single trail through a set of roads, each road used once.
 *
 * An opponent's building on a corner cuts the road there: a trail may run up
 * to it, or start from it, but never pass through it.
 */
export function longestRoad(roads: readonly Edge[], blocked: ReadonlySet<number>): number {
  const links = new Map<number, Array<{ to: number; id: number }>>()
  const unique = roads.filter((r, i) => roads.findIndex((q) => sameEdge(q, r)) === i)
  unique.forEach(([a, b], id) => {
    if (!links.has(a)) links.set(a, [])
    if (!links.has(b)) links.set(b, [])
    links.get(a)!.push({ to: b, id })
    links.get(b)!.push({ to: a, id })
  })

  const used = unique.map(() => false)
  let best = 0
  const walk = (at: number, length: number, canLeave: boolean) => {
    if (length > best) best = length
    if (!canLeave) return
    for (const { to, id } of links.get(at)!) {
      if (used[id]) continue
      used[id] = true
      walk(to, length + 1, !blocked.has(to))
      used[id] = false
    }
  }
  for (const start of links.keys()) walk(start, 0, true)
  return best
}

export interface SeatScore {
  roadLength: number
  longestRoad: boolean
  largestArmy: boolean
  /** Points everyone at the table can see. */
  publicPoints: number
  /** Public points plus victory point cards. */
  points: number
}

export interface Standings {
  scores: SeatScore[]
  /** Seats level on the longest road with no recorded holder; empty otherwise. */
  roadTie: number[]
  /** Seats level on the largest army with no recorded holder; empty otherwise. */
  armyTie: number[]
}

/**
 * Hand an award to the unique leader. On a tie the holder keeps it, as the
 * rules say — which a snapshot can only know from a recorded claim.
 */
function settleAward(values: number[], minimum: number, claimed: boolean[]) {
  const top = Math.max(...values)
  if (top < minimum) return { holder: -1, tie: [] as number[] }
  const leaders = values.flatMap((v, i) => (v === top ? [i] : []))
  if (leaders.length === 1) return { holder: leaders[0], tie: [] }
  const claimant = leaders.find((i) => claimed[i])
  return claimant === undefined ? { holder: -1, tie: leaders } : { holder: claimant, tie: [] }
}

export function standings(seats: readonly SeatPieces[]): Standings {
  const owners = vertexOwners(seats)
  const lengths = seats.map((s, i) => {
    const blocked = new Set(owners.flatMap((o, v) => (o >= 0 && o !== i ? [v] : [])))
    return longestRoad(s.roads, blocked)
  })

  const road = settleAward(lengths, LONGEST_ROAD_MIN, seats.map((s) => s.claims.includes('LR')))
  const army = settleAward(
    seats.map((s) => s.knights),
    LARGEST_ARMY_MIN,
    seats.map((s) => s.claims.includes('LA')),
  )

  const scores = seats.map((s, i) => {
    const longest = road.holder === i
    const largest = army.holder === i
    const publicPoints =
      s.settlements.length +
      s.cities.length * 2 +
      (longest ? AWARD_POINTS : 0) +
      (largest ? AWARD_POINTS : 0)
    return {
      roadLength: lengths[i],
      longestRoad: longest,
      largestArmy: largest,
      publicPoints,
      points: publicPoints + s.victoryCards,
    }
  })

  return { scores, roadTie: road.tie, armyTie: army.tie }
}

/**
 * Everything about a position that could not happen in a real game. These are
 * warnings, not errors: a position is a note to self, and may be mid-edit.
 */
export function positionProblems(seats: readonly SeatPieces[], names: readonly string[]): string[] {
  const problems: string[] = []
  const owners = vertexOwners(seats)

  seats.forEach((s, i) => {
    const who = names[i]
    if (s.settlements.length > PIECE_SUPPLY.settlements) {
      problems.push(`${who} has ${s.settlements.length} settlements; the box holds ${PIECE_SUPPLY.settlements}`)
    }
    if (s.cities.length > PIECE_SUPPLY.cities) {
      problems.push(`${who} has ${s.cities.length} cities; the box holds ${PIECE_SUPPLY.cities}`)
    }
    if (s.roads.length > PIECE_SUPPLY.roads) {
      problems.push(`${who} has ${s.roads.length} roads; the box holds ${PIECE_SUPPLY.roads}`)
    }

    // Every road has to trace back to one of the seat's own buildings.
    const reached = new Set([...s.settlements, ...s.cities])
    const connected = new Set<number>()
    let grew = true
    while (grew) {
      grew = false
      s.roads.forEach(([a, b], id) => {
        if (connected.has(id)) return
        const via = (v: number) => reached.has(v) && (owners[v] < 0 || owners[v] === i)
        if (via(a) || via(b)) {
          connected.add(id)
          reached.add(a)
          reached.add(b)
          grew = true
        }
      })
    }
    const loose = s.roads.filter((_, id) => !connected.has(id))
    if (loose.length > 0) {
      problems.push(
        `${who}'s ${loose.length === 1 ? 'road' : 'roads'} ${loose
          .map(([a, b]) => edgeLabel(a, b))
          .join(', ')} ${loose.length === 1 ? "isn't" : "aren't"} connected to their buildings`,
      )
    }
  })

  const crowded = owners.flatMap((o, v) =>
    o >= 0 && VERTEX_NEIGHBOURS[v].some((n) => n > v && owners[n] >= 0) ? [v] : [],
  )
  for (const v of crowded) {
    const n = VERTEX_NEIGHBOURS[v].find((n) => n > v && owners[n] >= 0)!
    problems.push(`${VERTEX_LABELS[v]} and ${VERTEX_LABELS[n]} are too close — buildings need a corner between them`)
  }

  const knights = seats.reduce((sum, s) => sum + s.knights, 0)
  if (knights > KNIGHT_SUPPLY) problems.push(`${knights} knights played; the deck only has ${KNIGHT_SUPPLY}`)
  const cards = seats.reduce((sum, s) => sum + s.victoryCards, 0)
  if (cards > VICTORY_CARD_SUPPLY) {
    problems.push(`${cards} victory point cards; the deck only has ${VICTORY_CARD_SUPPLY}`)
  }

  return problems
}

/* ------------------------------------------------------------------ *
 * Notation
 * ------------------------------------------------------------------ */

function formatSeat(seat: SeatPieces): string {
  const tokens = [
    ...[...seat.settlements].sort((a, b) => a - b).map((v) => `S${VERTEX_LABELS[v]}`),
    ...[...seat.cities].sort((a, b) => a - b).map((v) => `C${VERTEX_LABELS[v]}`),
    ...[...seat.roads]
      .sort((p, q) => p[0] - q[0] || p[1] - q[1])
      .map(([a, b]) => `R${edgeLabel(a, b)}`),
    ...(seat.knights > 0 ? [`K${seat.knights}`] : []),
    ...(seat.victoryCards > 0 ? [`V${seat.victoryCards}`] : []),
    ...seat.claims.map((a) => `^${a}`),
  ]
  return tokens.length > 0 ? tokens.join(' ') : '-'
}

/** The `[Position]` tag's value: each seat's pieces, `/`-separated. */
export function formatPosition(seats: readonly SeatPieces[]): string {
  return seats.map(formatSeat).join(' / ')
}

/** Parse a `[Position]` value. Tokens it cannot read land in `issues`. */
export function parsePosition(text: string, issues: ParseIssue[] = [], line = 0): SeatPieces[] {
  const seats = text.split('/').map((part) => {
    const seat = emptySeat()
    for (const token of part.trim().split(/\s+/).filter(Boolean)) {
      if (token === '-') continue
      const counter = /^([KV])(\d+)$/.exec(token)
      if (counter) {
        if (counter[1] === 'K') seat.knights = Number(counter[2])
        else seat.victoryCards = Number(counter[2])
        continue
      }
      const action = parseAction(token, issues, line)
      if (!action) continue
      if (action.kind === 'settlement') seat.settlements.push(action.vertex)
      else if (action.kind === 'city') seat.cities.push(action.vertex)
      else if (action.kind === 'road') seat.roads.push(action.edge)
      else if (action.kind === 'award') seat.claims.push(action.award)
      else issues.push({ line, message: `"${token}" is a move, not part of a position` })
    }
    return seat
  })

  // A later seat claiming a corner or edge wins it, so the result is always
  // a position the editor can show.
  let clean: SeatPieces[] = seats.map(emptySeat)
  seats.forEach((seat, i) => {
    for (const v of seat.settlements) {
      clean = clearVertex(clean, v)
      clean[i] = { ...clean[i], settlements: [...clean[i].settlements, v] }
    }
    for (const v of seat.cities) {
      clean = clearVertex(clean, v)
      clean[i] = { ...clean[i], cities: [...clean[i].cities, v] }
    }
    for (const r of seat.roads) {
      clean = clearEdge(clean, r)
      clean[i] = { ...clean[i], roads: [...clean[i].roads, r] }
    }
    clean[i] = {
      ...clean[i],
      knights: seat.knights,
      victoryCards: seat.victoryCards,
      claims: [...new Set(seat.claims)],
    }
  })
  return clean
}

/**
 * The same text made safe to sit unescaped in a URL: spaces become `.` and the
 * seat separator becomes `_`. Neither character appears in a position.
 */
export const positionToUrl = (text: string) =>
  text.replace(/\s*\/\s*/g, '_').replace(/\s+/g, '.')

export const positionFromUrl = (text: string) =>
  text.replace(/_/g, ' / ').replace(/\./g, ' ')

export const robberLabel = (hex: number) => HEX_LABELS[hex]
export const robberFromLabel = (label: string) => hexIndex(label.trim())
