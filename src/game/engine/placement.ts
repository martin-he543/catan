/**
 * Where pieces may go, and the longest road.
 *
 * Every check is written in terms of what a player can see, so the same code
 * that referees on the server also lights up legal spots in the browser —
 * even when the browser only has a redacted view with fog hidden.
 */
import { LARGEST_ARMY_MIN, LONGEST_ROAD_MIN } from './config'
import type { Topology } from './hexgrid'
import { knownLand, knownSea, supplyLeft, topo } from './state'
import { RuleError, type GameState, type Prompt, type RouteKind } from './types'

/* ------------------------------------------------------------------ *
 * Corners
 * ------------------------------------------------------------------ */

export function vertexTouchesLand(state: GameState, t: Topology, v: number): boolean {
  return t.vertices[v].hexes.some((h) => knownLand(state.map.hexes[h]))
}

/** No building, and no knight, on the corner. */
export const vertexFree = (state: GameState, v: number) => !state.buildings[v] && !state.knights[v]

/** The distance rule: no building on any neighbouring corner. */
export function distanceOk(state: GameState, t: Topology, v: number): boolean {
  return t.vertices[v].neighbors.every((n) => !state.buildings[n])
}

/** The corner is reached by one of this seat's roads or ships. */
export function vertexOnNetwork(state: GameState, t: Topology, seat: number, v: number): boolean {
  return t.vertices[v].edges.some((e) => state.routes[e]?.owner === seat)
}

function inHomeRegion(state: GameState, t: Topology, v: number): boolean {
  if (state.map.homeRegions.length === 0) return true
  return t.vertices[v].hexes.some((h) => {
    const hex = state.map.hexes[h]
    return knownLand(hex) && state.map.homeRegions.includes(hex.region)
  })
}

export function canPlaceSettlement(state: GameState, seat: number, v: number, setup: boolean): boolean {
  const t = topo(state)
  if (v < 0 || v >= t.vertices.length) return false
  if (!vertexFree(state, v)) return false
  if (!vertexTouchesLand(state, t, v) || !distanceOk(state, t, v)) return false
  if (setup) return inHomeRegion(state, t, v)
  if (supplyLeft(state, seat).settlement <= 0) return false
  return vertexOnNetwork(state, t, seat, v)
}

export function canPlaceCity(state: GameState, seat: number, v: number): boolean {
  const b = state.buildings[v]
  return !!b && b.owner === seat && b.kind === 'settlement' && supplyLeft(state, seat).city > 0
}

/* ------------------------------------------------------------------ *
 * Edges
 * ------------------------------------------------------------------ */

/** A road needs land on at least one side. */
export function edgeTakesRoad(state: GameState, t: Topology, e: number): boolean {
  return t.edges[e].hexes.some((h) => knownLand(state.map.hexes[h]))
}

/** A ship needs open water on at least one side, and both sides on the map. */
export function edgeTakesShip(state: GameState, t: Topology, e: number): boolean {
  if (!state.config.seafarers) return false
  const hexes = t.edges[e].hexes
  if (hexes.length < 2) return false
  if (hexes.some((h) => h === state.pirate)) return false
  // Both sides must be known: fog could hide land.
  if (hexes.some((h) => state.map.hexes[h].veil === 'fog')) {
    return hexes.some((h) => knownSea(state.map.hexes[h])) &&
      !hexes.some((h) => knownLand(state.map.hexes[h]))
  }
  return hexes.some((h) => knownSea(state.map.hexes[h]))
}

/** Someone else's building — or, in Cities & Knights, knight — cuts a road at this corner. */
export function blockedFor(state: GameState, seat: number, v: number): boolean {
  const b = state.buildings[v]
  if (b && b.owner !== seat) return true
  const k = state.knights[v]
  return !!k && k.owner !== seat
}

/**
 * Whether a route of `kind` on edge `e` joins `seat`'s network. Roads extend
 * roads and ships extend ships; the two only meet at the seat's own building.
 */
export function routeConnects(
  state: GameState,
  t: Topology,
  seat: number,
  e: number,
  kind: RouteKind,
  ignoreEdge = -1,
): boolean {
  const edge = t.edges[e]
  for (const v of [edge.a, edge.b]) {
    const b = state.buildings[v]
    if (b && b.owner === seat) return true
    if (blockedFor(state, seat, v)) continue
    const joined = t.vertices[v].edges.some((other) => {
      if (other === e || other === ignoreEdge) return false
      const r = state.routes[other]
      return !!r && r.owner === seat && r.kind === kind
    })
    if (joined) return true
  }
  return false
}

export function canPlaceRoute(
  state: GameState,
  seat: number,
  e: number,
  kind: RouteKind,
  opts: { anchor?: number | null; free?: boolean; ignoreEdge?: number } = {},
): boolean {
  const t = topo(state)
  if (e < 0 || e >= t.edges.length) return false
  if (state.routes[e]) return false
  if (kind === 'road' ? !edgeTakesRoad(state, t, e) : !edgeTakesShip(state, t, e)) return false
  const left = supplyLeft(state, seat)
  if ((kind === 'road' ? left.road : left.ship) <= 0) return false
  if (opts.anchor !== undefined && opts.anchor !== null) {
    // Setup: the route must touch the building just placed.
    return t.edges[e].a === opts.anchor || t.edges[e].b === opts.anchor
  }
  return routeConnects(state, t, seat, e, kind, opts.ignoreEdge ?? -1)
}

/**
 * A ship may sail when it is at the open end of a line — one of its ends
 * touches neither another of the owner's ships nor their building — and it
 * wasn't built this turn.
 */
export function shipCanMove(state: GameState, seat: number, e: number): boolean {
  const r = state.routes[e]
  if (!r || r.owner !== seat || r.kind !== 'ship') return false
  if (r.built === state.turn.number) return false
  const t = topo(state)
  if (t.edges[e].hexes.includes(state.pirate)) return false
  return [t.edges[e].a, t.edges[e].b].some((v) => {
    const b = state.buildings[v]
    if (b && b.owner === seat) return false
    return !t.vertices[v].edges.some((o) => o !== e && state.routes[o]?.owner === seat && state.routes[o]?.kind === 'ship')
  })
}

/* ------------------------------------------------------------------ *
 * Knights
 * ------------------------------------------------------------------ */

export function canPlaceKnight(state: GameState, seat: number, v: number): boolean {
  const t = topo(state)
  if (v < 0 || v >= t.vertices.length) return false
  if (!vertexFree(state, v)) return false
  if (supplyLeft(state, seat).knight[1] <= 0) return false
  return vertexOnNetwork(state, t, seat, v)
}

/**
 * Corners a knight at `from` can reach along its owner's roads and ships
 * without passing another piece. The start is excluded.
 */
export function knightReach(state: GameState, seat: number, from: number): Set<number> {
  const t = topo(state)
  const seen = new Set<number>([from])
  const stack = [from]
  const out = new Set<number>()
  while (stack.length) {
    const v = stack.pop()!
    for (const e of t.vertices[v].edges) {
      if (state.routes[e]?.owner !== seat) continue
      const w = t.edges[e].a === v ? t.edges[e].b : t.edges[e].a
      if (seen.has(w)) continue
      seen.add(w)
      const occupiedByOther = (state.buildings[w] && state.buildings[w]!.owner !== seat) || state.knights[w]
      if (state.knights[w]) out.add(w) // reachable as a displacement target, but not passable
      else if (!state.buildings[w]) out.add(w)
      if (!occupiedByOther) stack.push(w)
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Longest road
 * ------------------------------------------------------------------ */

/**
 * The longest single trail through a seat's roads and ships, each piece used
 * once. Opponents' buildings (and knights, in Cities & Knights) cut the trail,
 * and a road only turns into a ship at the seat's own building.
 */
export function longestRoute(state: GameState, seat: number): number {
  const t = topo(state)
  const mine: number[] = []
  state.routes.forEach((r, e) => {
    if (r && r.owner === seat) mine.push(e)
  })
  if (mine.length === 0) return 0

  const used = new Set<number>()
  let best = 0
  const walk = (v: number, lastKind: RouteKind | null, length: number) => {
    if (length > best) best = length
    for (const e of t.vertices[v].edges) {
      if (used.has(e)) continue
      const r = state.routes[e]
      if (!r || r.owner !== seat) continue
      if (lastKind && lastKind !== r.kind) {
        const b = state.buildings[v]
        if (!b || b.owner !== seat) continue
      }
      const w = t.edges[e].a === v ? t.edges[e].b : t.edges[e].a
      used.add(e)
      if (blockedFor(state, seat, w)) {
        if (length + 1 > best) best = length + 1
      } else {
        walk(w, r.kind, length + 1)
      }
      used.delete(e)
    }
  }
  const starts = new Set<number>()
  for (const e of mine) {
    starts.add(t.edges[e].a)
    starts.add(t.edges[e].b)
  }
  for (const v of starts) walk(v, null, 0)
  return best
}

/**
 * Re-settle the longest road. The holder keeps it on a tie; if they are
 * overtaken by one player, that player takes it; if the holder drops back
 * and several are level, it is set aside.
 */
export function updateLongestRoad(state: GameState): number | null {
  const lengths = state.players.map((p, i) => (p.resigned ? 0 : longestRoute(state, i)))
  const top = Math.max(...lengths)
  const holder = state.longestRoad?.owner ?? null
  let next: number | null = null
  if (holder !== null && lengths[holder] >= top && lengths[holder] >= LONGEST_ROAD_MIN) {
    next = holder
  } else if (top >= LONGEST_ROAD_MIN) {
    const leaders = lengths.flatMap((l, i) => (l === top ? [i] : []))
    if (leaders.length === 1) next = leaders[0]
  }
  state.longestRoad = next === null ? null : { owner: next, size: lengths[next] }
  return next !== holder ? next : null
}

export function updateLargestArmy(state: GameState): number | null {
  if (state.config.citiesKnights) return null
  const sizes = state.players.map((p) => p.knightsPlayed)
  const holder = state.largestArmy?.owner ?? null
  const top = Math.max(...sizes)
  if (top < LARGEST_ARMY_MIN) {
    state.largestArmy = null
    return null
  }
  if (holder !== null && sizes[holder] >= top) {
    state.largestArmy = { owner: holder, size: sizes[holder] }
    return null
  }
  const leaders = sizes.flatMap((s, i) => (s === top ? [i] : []))
  if (leaders.length === 1) {
    state.largestArmy = { owner: leaders[0], size: top }
    return leaders[0] !== holder ? leaders[0] : null
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Listing legal spots (for the UI and bots)
 * ------------------------------------------------------------------ */

export function legalSettlements(state: GameState, seat: number, setup = false): number[] {
  const t = topo(state)
  return t.vertices.flatMap((_, v) => (canPlaceSettlement(state, seat, v, setup) ? [v] : []))
}

export function legalCities(state: GameState, seat: number): number[] {
  return state.buildings.flatMap((_, v) => (canPlaceCity(state, seat, v) ? [v] : []))
}

export function legalRoutes(
  state: GameState,
  seat: number,
  kind: RouteKind,
  opts: { anchor?: number | null; ignoreEdge?: number } = {},
): number[] {
  const t = topo(state)
  return t.edges.flatMap((_, e) => (canPlaceRoute(state, seat, e, kind, opts) ? [e] : []))
}

export function legalKnights(state: GameState, seat: number): number[] {
  const t = topo(state)
  return t.vertices.flatMap((_, v) => (canPlaceKnight(state, seat, v) ? [v] : []))
}

/** The piece a free-road answer builds: one the prompt offers, and legal there. */
export function routeAnswer(state: GameState, prompt: Prompt, edge: number, piece: unknown): RouteKind {
  const offered = (prompt.input.kind === 'board' ? prompt.input.pieces : undefined) ?? ['road']
  const kind = piece === undefined
    ? (canPlaceRoute(state, prompt.seat, edge, offered[0]) ? offered[0] : offered[offered.length - 1])
    : (piece as RouteKind)
  if (!offered.includes(kind)) throw new RuleError(`that has to be a ${offered.join(' or ')}`)
  if (!canPlaceRoute(state, prompt.seat, edge, kind)) throw new RuleError(`a ${kind} can't go there`)
  return kind
}

