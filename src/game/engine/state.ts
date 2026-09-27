/**
 * Small queries and mutations shared by every rule module: hands and costs,
 * piece counts, harbours, scoring, logging and the prompt queue.
 */
import { FISH_HAND_LIMIT, SUPPLY } from './config'
import { buildTopology, sideVertices, type Topology } from './hexgrid'
import {
  CARDS,
  COMMODITIES,
  RESOURCES,
  RuleError,
  type Card,
  type CardCounts,
  type Commodity,
  type DevCardType,
  type GameState,
  type Hand,
  type HexState,
  type LogEntry,
  type Prompt,
  type Resource,
  type Step,
  type Terrain,
} from './types'

/* ------------------------------------------------------------------ *
 * Topology
 * ------------------------------------------------------------------ */

export const topo = (state: GameState): Topology => buildTopology(state.map.hexes)

/** Land a player can see is land. Fog hides whether a hex is land at all. */
export const knownLand = (h: HexState) => h.terrain !== 'sea' && h.veil !== 'fog'
export const knownSea = (h: HexState) => h.terrain === 'sea' && h.veil !== 'fog'

/* ------------------------------------------------------------------ *
 * Cards
 * ------------------------------------------------------------------ */

export const emptyHand = (): Hand =>
  Object.fromEntries(CARDS.map((c) => [c, 0])) as Hand

export const countOf = (cards: CardCounts) =>
  Object.values(cards).reduce<number>((sum, n) => sum + (n ?? 0), 0)

export const handSize = (hand: Hand) => CARDS.reduce((sum, c) => sum + hand[c], 0)

export const resourceCount = (hand: Hand) => RESOURCES.reduce((sum, c) => sum + hand[c], 0)

export function hasCards(hand: Hand, cards: CardCounts): boolean {
  return CARDS.every((c) => hand[c] >= (cards[c] ?? 0))
}

/** Validate a card list: known kinds, whole non-negative counts. */
export function cleanCards(cards: CardCounts | undefined): CardCounts {
  const out: CardCounts = {}
  if (!cards || typeof cards !== 'object') return out
  for (const [k, v] of Object.entries(cards)) {
    if (!(CARDS as readonly string[]).includes(k)) throw new RuleError(`"${k}" is not a card`)
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new RuleError('card counts must be whole numbers')
    if (v > 0) out[k as Card] = v
  }
  return out
}

export function addCards(hand: Hand, cards: CardCounts) {
  for (const c of CARDS) hand[c] += cards[c] ?? 0
}

export function removeCards(hand: Hand, cards: CardCounts) {
  if (!hasCards(hand, cards)) throw new RuleError("you don't have those cards")
  for (const c of CARDS) hand[c] -= cards[c] ?? 0
}

/** Pay the bank. */
export function pay(state: GameState, seat: number, cost: CardCounts) {
  removeCards(state.players[seat].hand, cost)
  addCards(state.bank, cost)
}

/** Take from the bank, as far as it can pay. Returns what was actually given. */
export function takeFromBank(state: GameState, seat: number, cards: CardCounts): CardCounts {
  const given: CardCounts = {}
  for (const c of CARDS) {
    const n = Math.min(cards[c] ?? 0, state.bank[c])
    if (n > 0) {
      given[c] = n
      state.bank[c] -= n
      state.players[seat].hand[c] += n
    }
  }
  return given
}

/** Move one random card from one hand to another; returns the card, or null. */
export function stealRandom(state: GameState, from: number, to: number, rng: { next(): number }): Card | null {
  const hand = state.players[from].hand
  const total = handSize(hand)
  if (total === 0) return null
  let pickAt = Math.floor(rng.next() * total)
  for (const c of CARDS) {
    if (pickAt < hand[c]) {
      hand[c]--
      state.players[to].hand[c]++
      return c
    }
    pickAt -= hand[c]
  }
  return null
}

export const COSTS = {
  road: { brick: 1, lumber: 1 },
  ship: { lumber: 1, sheep: 1 },
  settlement: { brick: 1, lumber: 1, sheep: 1, wheat: 1 },
  city: { ore: 3, wheat: 2 },
  dev: { ore: 1, sheep: 1, wheat: 1 },
  wall: { brick: 2 },
  knight: { sheep: 1, ore: 1 },
  activate: { wheat: 1 },
  promote: { sheep: 1, ore: 1 },
  medicineCity: { ore: 2, wheat: 1 },
} as const satisfies Record<string, CardCounts>

/** The commodity each improvement track is paid in. */
export const TRACK_COMMODITY = { trade: 'cloth', politics: 'coin', science: 'paper' } as const

/** Which commodity a city on this terrain makes in Cities & Knights. */
export const COMMODITY_OF: Partial<Record<Terrain, Commodity>> = {
  lumber: 'paper',
  sheep: 'cloth',
  ore: 'coin',
}

export const isResource = (c: string): c is Resource => (RESOURCES as readonly string[]).includes(c)
export const isCommodity = (c: string): c is Commodity => (COMMODITIES as readonly string[]).includes(c)

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

export function pieceCounts(state: GameState, seat: number) {
  let settlements = 0
  let cities = 0
  let walls = 0
  let metropolises = 0
  for (const b of state.buildings) {
    if (!b || b.owner !== seat) continue
    if (b.kind === 'settlement') settlements++
    else {
      cities++
      if (b.wall) walls++
      if (b.metropolis) metropolises++
    }
  }
  let roads = 0
  let ships = 0
  for (const r of state.routes) {
    if (!r || r.owner !== seat) continue
    if (r.kind === 'road') roads++
    else ships++
  }
  const knights = [0, 0, 0, 0]
  for (const k of state.knights) if (k && k.owner === seat) knights[k.level]++
  return { settlements, cities, walls, metropolises, roads, ships, knights }
}

export function supplyLeft(state: GameState, seat: number) {
  const c = pieceCounts(state, seat)
  return {
    road: SUPPLY.road - c.roads,
    ship: state.config.seafarers ? SUPPLY.ship - c.ships : 0,
    settlement: SUPPLY.settlement - c.settlements,
    city: SUPPLY.city - c.cities,
    wall: SUPPLY.wall - c.walls,
    knight: [0, SUPPLY.knight - c.knights[1], SUPPLY.knight - c.knights[2], SUPPLY.knight - c.knights[3]],
  }
}

/** Buildings at the corners of a hex. */
export function buildingsOnHex(state: GameState, hex: number) {
  return topo(state).hexes[hex].corners.flatMap((v) => {
    const b = state.buildings[v]
    return b ? [{ vertex: v, ...b }] : []
  })
}

/** Seats with a building on this hex, other than `except`. */
export function ownersOnHex(state: GameState, hex: number, except?: number): number[] {
  return [...new Set(buildingsOnHex(state, hex).map((b) => b.owner))].filter((o) => o !== except)
}

/** Seats with a ship on one of this hex's sides, other than `except`. */
export function shipOwnersOnHex(state: GameState, hex: number, except?: number): number[] {
  const t = topo(state)
  const owners = new Set<number>()
  for (const e of t.hexes[hex].sides) {
    const r = state.routes[e]
    if (r && r.kind === 'ship' && r.owner !== except) owners.add(r.owner)
  }
  return [...owners]
}

/* ------------------------------------------------------------------ *
 * Harbours and trade ratios
 * ------------------------------------------------------------------ */

/** Harbour vertices, as vertex -> harbour type. */
export function harborVertices(state: GameState): Map<number, string> {
  const t = topo(state)
  const out = new Map<number, string>()
  for (const h of state.map.harbors) {
    const [a, b] = sideVertices(t, h.hex, h.side)
    out.set(a, h.type)
    out.set(b, h.type)
  }
  return out
}

/** The best bank rate for each card this seat could trade away. */
export function tradeRatios(state: GameState, seat: number): Record<Card, number> {
  const ratios = Object.fromEntries(CARDS.map((c) => [c, 4])) as Record<Card, number>
  const harbors = harborVertices(state)
  state.buildings.forEach((b, v) => {
    if (!b || b.owner !== seat) return
    const type = harbors.get(v)
    if (!type) return
    if (type === 'any') {
      for (const c of CARDS) ratios[c] = Math.min(ratios[c], 3)
    } else {
      ratios[type as Card] = 2
    }
  })
  const player = state.players[seat]
  if (state.config.citiesKnights && player.improvements.trade >= 3) {
    // Trading House: commodities trade 2:1.
    for (const c of COMMODITIES) ratios[c] = Math.min(ratios[c], 2)
  }
  if (state.merchant && state.merchant.owner === seat) {
    const terrain = state.map.hexes[state.merchant.hex].terrain
    if (isResource(terrain)) ratios[terrain] = 2
  }
  const holder = state.turn.stage.kind === 'main' ? state.turn.seat : state.turn.stage.seat
  if (state.turn.fleet && holder === seat) ratios[state.turn.fleet] = 2
  return ratios
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

export function publicPoints(state: GameState, seat: number): number {
  const p = state.players[seat]
  const c = pieceCounts(state, seat)
  let points = c.settlements + c.cities * 2 + c.metropolises * 2
  if (state.longestRoad?.owner === seat) points += 2
  if (!state.config.citiesKnights && state.largestArmy?.owner === seat) points += 2
  points += p.progressPoints + p.defenderPoints + p.islandPoints
  if (state.merchant?.owner === seat) points += 1
  return points
}

export const hiddenPoints = (state: GameState, seat: number) =>
  state.players[seat].dev.filter((d) => d.type === 'victory').length

export const totalPoints = (state: GameState, seat: number) =>
  publicPoints(state, seat) + hiddenPoints(state, seat)

/** Points needed to win, raised by one for whoever holds the old boot. */
export const targetFor = (state: GameState, seat: number) =>
  state.config.vpTarget + (state.players[seat].hasBoot ? 1 : 0)

/** The discard threshold, raised by city walls in Cities & Knights. */
export function discardLimit(state: GameState, seat: number): number {
  let limit = state.config.discardLimit
  if (state.config.citiesKnights) limit += 2 * pieceCounts(state, seat).walls
  return limit
}

export const fishLimit = FISH_HAND_LIMIT

/* ------------------------------------------------------------------ *
 * Log
 * ------------------------------------------------------------------ */

const LOG_LIMIT = 250

export function log(state: GameState, seat: number | null, text: string, extra: Partial<LogEntry> = {}) {
  state.log.push({ n: state.seq, seat, text, ...extra })
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT)
}

export const nameOf = (state: GameState, seat: number) => state.players[seat].name

const CARD_NAMES: Record<Card, [string, string]> = {
  brick: ['brick', 'brick'],
  lumber: ['lumber', 'lumber'],
  ore: ['ore', 'ore'],
  sheep: ['wool', 'wool'],
  wheat: ['grain', 'grain'],
  paper: ['paper', 'paper'],
  cloth: ['cloth', 'cloth'],
  coin: ['coin', 'coin'],
}

export const cardName = (c: Card) => CARD_NAMES[c][0]

export const DEV_NAMES: Record<DevCardType, string> = {
  knight: 'a Knight',
  victory: 'a Victory Point',
  roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty',
  monopoly: 'Monopoly',
}

/** "2 brick, 1 grain" */
export function describeCards(cards: CardCounts): string {
  const parts = CARDS.filter((c) => (cards[c] ?? 0) > 0).map((c) => `${cards[c]} ${cardName(c)}`)
  return parts.length ? parts.join(', ') : 'nothing'
}

/* ------------------------------------------------------------------ *
 * Queue
 * ------------------------------------------------------------------ */

/**
 * Ids come from a counter kept in the state, so replaying the same actions
 * mints the same ids and recorded responses still find their prompts.
 */
export function promptId(state: GameState, suffix: string): string {
  state.ids = (state.ids ?? 0) + 1
  return `p${state.ids}-${suffix}`
}

export function makePrompt(
  state: GameState,
  fields: Omit<Prompt, 'kind' | 'id' | 'group'> & { group?: string },
): Prompt {
  const id = promptId(state, `${fields.type}${fields.seat}`)
  return { kind: 'prompt', id, group: fields.group ?? id, ...fields }
}

/** Put steps at the front of the queue, in the order given. */
export function pushFront(state: GameState, ...steps: Step[]) {
  state.queue.unshift(...steps)
}

export function pushBack(state: GameState, ...steps: Step[]) {
  state.queue.push(...steps)
}

/** The prompts that may be answered right now: the leading group. */
export function activePrompts(state: GameState): Prompt[] {
  const first = state.queue[0]
  if (!first || first.kind !== 'prompt') return []
  const out: Prompt[] = []
  for (const step of state.queue) {
    if (step.kind !== 'prompt' || step.group !== first.group) break
    out.push(step)
  }
  return out
}

/** Next seat in turn order that hasn't resigned. */
export function nextSeat(state: GameState, from: number): number {
  const n = state.players.length
  for (let i = 1; i <= n; i++) {
    const s = (from + i) % n
    if (!state.players[s].resigned) return s
  }
  return from
}

/** Seats other than `seat`, in turn order after it. */
export function othersInOrder(state: GameState, seat: number): number[] {
  const n = state.players.length
  const out: number[] = []
  for (let i = 1; i < n; i++) {
    const s = (seat + i) % n
    if (!state.players[s].resigned) out.push(s)
  }
  return out
}
