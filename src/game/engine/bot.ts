/**
 * Bots, and the autopilot that plays for anyone whose turn timer runs out.
 *
 * The bot is a plain heuristic player — it values corners by pips, variety
 * and harbours, builds towards the best spot it can reach by road or ship,
 * trades with the bank to finish what it is saving for, and always has a
 * sensible answer for every prompt the rules can raise. It never needs to
 * look ahead, so it is cheap enough to run in the host's browser.
 */
import { canImprove, canPromote, knightCanAct, knightStrength } from './ck'
import { BARBARIAN_TRACK } from './config'
import { FISH_COSTS } from './fish'
import {
  canPlaceRoute,
  distanceOk,
  edgeTakesRoad,
  edgeTakesShip,
  legalCities,
  legalKnights,
  legalRoutes,
  legalSettlements,
  shipCanMove,
  vertexFree,
  vertexTouchesLand,
} from './placement'
import { actingSeat } from './rules'
import {
  COSTS,
  activePrompts,
  countOf,
  handSize,
  harborVertices,
  hasCards,
  isResource,
  pieceCounts,
  publicPoints,
  supplyLeft,
  topo,
  totalPoints,
  tradeRatios,
} from './state'
import {
  CARDS,
  RESOURCES,
  type Action,
  type Card,
  type CardCounts,
  type GameState,
  type Hand,
  type Prompt,
  type Resource,
  type RouteKind,
} from './types'

const PIPS = (n: number | undefined) => (n === undefined || n === 7 || n < 2 || n > 12 ? 0 : 6 - Math.abs(n - 7))

/* ------------------------------------------------------------------ *
 * Evaluating the board
 * ------------------------------------------------------------------ */

function vertexProduction(state: GameState, v: number): Partial<Record<Resource | 'gold', number>> {
  const t = topo(state)
  const out: Partial<Record<Resource | 'gold', number>> = {}
  for (const h of t.vertices[v].hexes) {
    const hex = state.map.hexes[h]
    if (hex.veil === 'fog' || h === state.robber) continue
    const pips = PIPS(hex.number)
    if (hex.veil === 'blind') {
      out.gold = (out.gold ?? 0) + 2 // unknown land is worth something
      continue
    }
    if (hex.terrain === 'gold') out.gold = (out.gold ?? 0) + pips
    else if (isResource(hex.terrain)) out[hex.terrain] = (out[hex.terrain] ?? 0) + (hex.veil === 'terrain' ? pips * 0.9 : pips)
  }
  return out
}

/** How much a seat would like a settlement on `v`. */
export function vertexScore(state: GameState, seat: number, v: number): number {
  const prod = vertexProduction(state, v)
  const owned = new Set<Resource>()
  state.buildings.forEach((b, w) => {
    if (b?.owner !== seat) return
    for (const r of RESOURCES) if ((vertexProduction(state, w)[r] ?? 0) > 0) owned.add(r)
  })
  let score = 0
  for (const r of RESOURCES) {
    const p = prod[r] ?? 0
    if (p === 0) continue
    score += p * (owned.has(r) ? 1 : 1.35)
    if (r === 'ore' || r === 'wheat') score += p * 0.15
  }
  score += (prod.gold ?? 0) * 1.4
  const harbor = harborVertices(state).get(v)
  if (harbor) score += harbor === 'any' ? 1.2 : (prod[harbor as Resource] ?? 0) >= 4 ? 2.5 : 0.8
  // A new island pays a bonus in Seafarers.
  if (state.config.islandBonus > 0) {
    const t = topo(state)
    const p = state.players[seat]
    const region = t.vertices[v].hexes.map((h) => state.map.hexes[h].region).find((r) => r >= 0)
    if (region !== undefined && !p.homeRegions.includes(region) && !p.rewardedRegions.includes(region)) {
      score += state.config.islandBonus * 2.5
    }
  }
  return score
}

/** Would a settlement be legal here, ignoring whether a road reaches it? */
function openSpot(state: GameState, v: number): boolean {
  const t = topo(state)
  return vertexFree(state, v) && vertexTouchesLand(state, t, v) && distanceOk(state, t, v)
}

/**
 * The next road or ship towards the best reachable spot for a new
 * settlement: breadth-first over empty edges from the seat's network.
 */
function routeTowardsBestSpot(state: GameState, seat: number): { edge: number; kind: RouteKind } | null {
  const t = topo(state)
  const left = supplyLeft(state, seat)
  const starts = new Set<number>()
  state.routes.forEach((r, e) => {
    if (r?.owner === seat) {
      starts.add(t.edges[e].a)
      starts.add(t.edges[e].b)
    }
  })
  state.buildings.forEach((b, v) => b?.owner === seat && starts.add(v))
  if (starts.size === 0) return null

  // BFS keeping the first edge taken from the network.
  const first = new Map<number, { edge: number; kind: RouteKind } | null>()
  const dist = new Map<number, number>()
  const queue: number[] = []
  for (const s of starts) {
    first.set(s, null)
    dist.set(s, 0)
    queue.push(s)
  }
  let best: { score: number; step: { edge: number; kind: RouteKind } } | null = null
  while (queue.length) {
    const v = queue.shift()!
    const d = dist.get(v)!
    if (d > 6) continue
    if (d > 0) {
      let value = openSpot(state, v) ? vertexScore(state, seat, v) : 0
      // Fog is worth exploring: whatever is under it pays a card when found.
      if (t.vertices[v].hexes.some((h) => state.map.hexes[h].veil === 'fog')) value = Math.max(value, 6)
      const score = value / (1 + d * 0.9)
      const step = first.get(v)
      if (value > 0 && step && (!best || score > best.score)) best = { score, step }
    }
    const b = state.buildings[v]
    if (b && b.owner !== seat) continue
    if (state.knights[v] && state.knights[v]!.owner !== seat && d > 0) continue
    for (const e of t.vertices[v].edges) {
      if (state.routes[e]) continue
      const w = t.edges[e].a === v ? t.edges[e].b : t.edges[e].a
      if (dist.has(w)) continue
      const kind: RouteKind | null = edgeTakesRoad(state, t, e) && left.road > 0 ? 'road'
        : edgeTakesShip(state, t, e) && left.ship > 0 ? 'ship' : null
      if (!kind) continue
      let step = first.get(v) ?? null
      if (!step) {
        if (!canPlaceRoute(state, seat, e, kind)) {
          const other: RouteKind = kind === 'road' ? 'ship' : 'road'
          if (!canPlaceRoute(state, seat, e, other)) continue
          step = { edge: e, kind: other }
        } else step = { edge: e, kind }
      }
      dist.set(w, d + 1)
      first.set(w, step)
      queue.push(w)
    }
  }
  return best?.step ?? null
}

/* ------------------------------------------------------------------ *
 * Saving and trading
 * ------------------------------------------------------------------ */

type Goal = 'city' | 'settlement' | 'dev' | 'road' | 'ship' | 'knight' | 'activate'

function goalCost(goal: Goal): CardCounts {
  switch (goal) {
    case 'city': return COSTS.city
    case 'settlement': return COSTS.settlement
    case 'dev': return COSTS.dev
    case 'road': return COSTS.road
    case 'ship': return COSTS.ship
    case 'knight': return COSTS.knight
    case 'activate': return COSTS.activate
  }
}

function missing(hand: Hand, cost: CardCounts): CardCounts {
  const out: CardCounts = {}
  for (const c of CARDS) {
    const short = (cost[c] ?? 0) - hand[c]
    if (short > 0) out[c] = short
  }
  return out
}

/** A single bank trade that brings a goal closer, using only spare cards. */
function bankTradeFor(state: GameState, seat: number, cost: CardCounts): Action | null {
  const hand = state.players[seat].hand
  const need = missing(hand, cost)
  const want = (Object.keys(need) as Card[]).find((c) => state.bank[c] > 0)
  if (!want) return null
  const ratios = tradeRatios(state, seat)
  const spare = CARDS.filter((c) => c !== want && hand[c] - (cost[c] ?? 0) >= ratios[c])
    .sort((a, b) => ratios[a] - ratios[b] || (hand[b] - (cost[b] ?? 0)) - (hand[a] - (cost[a] ?? 0)))
  if (!spare.length) return null
  const give = spare[0]
  return { type: 'tradeBank', give: { [give]: ratios[give] }, get: { [want]: 1 } }
}

/** Whether spare cards could cover the shortfall with bank trades. */
function reachableByTrade(state: GameState, seat: number, cost: CardCounts): boolean {
  const hand = state.players[seat].hand
  const ratios = tradeRatios(state, seat)
  const short = countOf(missing(hand, cost))
  let credit = 0
  for (const c of CARDS) credit += Math.floor(Math.max(0, hand[c] - (cost[c] ?? 0)) / ratios[c])
  return credit >= short
}

/** Cards this seat most wants right now, most wanted first. */
function wanted(state: GameState, seat: number): Card[] {
  const hand = state.players[seat].hand
  const goals: CardCounts[] = []
  if (legalCities(state, seat).length) goals.push(COSTS.city)
  goals.push(COSTS.settlement, COSTS.road)
  if (!state.config.citiesKnights) goals.push(COSTS.dev)
  const need = new Map<Card, number>()
  goals.forEach((g, rank) => {
    for (const [c, n] of Object.entries(missing(hand, g))) need.set(c as Card, (need.get(c as Card) ?? 0) + (n ?? 0) * (4 - rank))
  })
  return [...need.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
}

/* ------------------------------------------------------------------ *
 * Prompts
 * ------------------------------------------------------------------ */

function pickCards(state: GameState, seat: number, prompt: Prompt): CardCounts {
  if (prompt.input.kind !== 'cards') return {}
  const input = prompt.input
  const allowed = input.allowed ?? [...CARDS]
  const source = input.source === 'hand' ? state.players[seat].hand
    : input.source === 'bank' ? state.bank : state.players[input.source.seat].hand
  const counts = Object.fromEntries(allowed.map((c) => [c, source[c]])) as Record<Card, number>
  const out: CardCounts = {}
  const giving = input.source === 'hand'
  const want = wanted(state, seat)
  for (let i = 0; i < input.count; i++) {
    const options = allowed.filter((c) => counts[c] > 0)
    if (!options.length) break
    let choice: Card
    if (giving) {
      // Give away what we hold most of and need least.
      choice = options.sort((a, b) => counts[b] - counts[a] || want.indexOf(b) - want.indexOf(a))[0]
    } else {
      const liked = want.filter((c) => options.includes(c))
      choice = liked[0] ?? options.sort((a, b) => state.players[seat].hand[a] - state.players[seat].hand[b])[0]
    }
    counts[choice]--
    out[choice] = (out[choice] ?? 0) + 1
    // Don't grab four of one card from the bank when two kinds are missing.
    if (!giving) want.push(want.shift()!)
  }
  return out
}

function robberHex(state: GameState, seat: number, hexes: number[]): number {
  const t = topo(state)
  const leader = state.players.map((_, i) => (i === seat ? -1 : publicPoints(state, i)))
  const top = Math.max(...leader)
  let best = hexes[0]
  let bestScore = -Infinity
  for (const h of hexes) {
    const hex = state.map.hexes[h]
    let score = 0
    if (hex.terrain === 'sea') {
      for (const e of t.hexes[h].sides) {
        const r = state.routes[e]
        if (r?.kind === 'ship') score += r.owner === seat ? -3 : 1 + (leader[r.owner] === top ? 1 : 0)
      }
    } else {
      const pips = PIPS(hex.number)
      for (const v of t.hexes[h].corners) {
        const b = state.buildings[v]
        if (!b) continue
        const weight = b.kind === 'city' ? 2 : 1
        if (b.owner === seat) score -= pips * weight * 3
        else score += pips * weight * (leader[b.owner] === top ? 1.5 : 1) + (handSize(state.players[b.owner].hand) > 0 ? 1 : 0)
      }
    }
    if (score > bestScore) {
      bestScore = score
      best = h
    }
  }
  return best
}

function respondTo(state: GameState, seat: number, prompt: Prompt): Action {
  const base = { type: 'respond' as const, prompt: prompt.id }
  const input = prompt.input
  switch (prompt.type) {
    case 'robber':
    case 'bishop':
      return { ...base, hex: robberHex(state, seat, input.kind === 'board' ? input.hexes ?? [] : []) }
    case 'freeRoad':
    case 'fishRoad': {
      const step = routeTowardsBestSpot(state, seat)
      const edges = input.kind === 'board' ? input.edges ?? [] : []
      if (step && edges.includes(step.edge)) return { ...base, edge: step.edge, piece: step.kind }
      if (!edges.length) return { ...base, skip: true }
      const e = edges[0]
      return { ...base, edge: e, piece: canPlaceRoute(state, seat, e, 'road') ? 'road' : 'ship' }
    }
    case 'inventor': {
      // Swap a good number onto our tile and a poor one away.
      const hexes = input.kind === 'board' ? input.hexes ?? [] : []
      const t = topo(state)
      const mine = (h: number) => t.hexes[h].corners.some((v) => state.buildings[v]?.owner === seat)
      const sorted = [...hexes].sort((a, b) => PIPS(state.map.hexes[b].number) - PIPS(state.map.hexes[a].number))
      const good = sorted.find((h) => !mine(h)) ?? sorted[0]
      const poor = [...sorted].reverse().find((h) => mine(h) && h !== good) ?? sorted.find((h) => h !== good)!
      return { ...base, hexes: [good, poor] }
    }
    case 'steal':
    case 'fishSteal':
    case 'masterMerchantSeat':
    case 'spySeat':
    case 'deserterSeat': {
      const options = input.kind === 'choice' ? input.options : []
      const best = [...options].sort((a, b) => {
        const pa = Number(a.id)
        const pb = Number(b.id)
        return totalPoints(state, pb) - totalPoints(state, pa) || handSize(state.players[pb].hand) - handSize(state.players[pa].hand)
      })[0]
      return { ...base, choice: best?.id }
    }
    case 'monopoly':
    case 'resourceMonopoly':
    case 'tradeMonopoly': {
      const options = input.kind === 'choice' ? input.options : []
      const held = (id: string) => state.players.reduce((s, p, i) => s + (i === seat ? 0 : p.hand[id as Card] ?? 0), 0)
      const best = [...options].sort((a, b) => held(b.id) - held(a.id))[0]
      return { ...base, choice: best?.id }
    }
    case 'merchantFleet': {
      const hand = state.players[seat].hand
      const best = [...CARDS].sort((a, b) => hand[b] - hand[a])[0]
      return { ...base, choice: best }
    }
    case 'defenderPick':
    case 'spyCard':
    case 'progressDiscard': {
      const options = input.kind === 'choice' ? input.options : []
      if (prompt.type === 'defenderPick') {
        const prefer = ['science', 'politics', 'trade'].find((t) => options.some((o) => o.id === t))
        return { ...base, choice: prefer ?? options[0]?.id }
      }
      return { ...base, choice: options[options.length - 1]?.id }
    }
    case 'merchantPlace': {
      const hexes = input.kind === 'board' ? input.hexes ?? [] : []
      const best = [...hexes].sort((a, b) => PIPS(state.map.hexes[b].number) - PIPS(state.map.hexes[a].number))[0]
      return { ...base, hex: best }
    }
    case 'cityLoss':
    case 'metropolis':
    case 'displaced':
    case 'deserterRemove':
    case 'deserterPlace':
    case 'medicine':
    case 'engineer':
    case 'smith':
    case 'intrigue': {
      const vertices = input.kind === 'board' ? input.vertices ?? [] : []
      if (!vertices.length) return { ...base, skip: true }
      const scored = [...vertices].sort((a, b) => vertexScore(state, seat, b) - vertexScore(state, seat, a))
      // Lose the worst city, remove the weakest knight; otherwise take the best spot.
      if (prompt.type === 'cityLoss') return { ...base, vertex: scored[scored.length - 1] }
      if (prompt.type === 'deserterRemove') {
        const weakest = [...vertices].sort((a, b) => (state.knights[a]?.level ?? 0) - (state.knights[b]?.level ?? 0))[0]
        return { ...base, vertex: weakest }
      }
      return { ...base, vertex: scored[0] }
    }
    case 'diplomatRemove': {
      const edges = input.kind === 'board' ? input.edges ?? [] : []
      const theirs = edges.find((e) => state.routes[e]?.owner !== seat)
      return { ...base, edge: theirs ?? edges[0] }
    }
    case 'diplomatReplace': {
      const edges = input.kind === 'board' ? input.edges ?? [] : []
      return edges.length ? { ...base, edge: edges[0] } : { ...base, skip: true }
    }
    default:
      break
  }
  if (input.kind === 'cards') return { ...base, cards: pickCards(state, seat, prompt) }
  if (input.kind === 'choice') return { ...base, choice: input.options[0]?.id }
  if (prompt.optional) return { ...base, skip: true }
  if (input.vertices?.length) return { ...base, vertex: input.vertices[0] }
  if (input.edges?.length) return { ...base, edge: input.edges[0] }
  if (input.hexes?.length) return { ...base, hex: input.hexes[0] }
  return { ...base, skip: true }
}

/* ------------------------------------------------------------------ *
 * Setup
 * ------------------------------------------------------------------ */

function setupMove(state: GameState, seat: number): Action | null {
  const setup = state.setup!
  const step = setup.steps[setup.index]
  if (setup.anchor === null) {
    const spots = legalSettlements(state, seat, true)
    if (!spots.length) return null
    const best = spots.reduce((a, b) => (vertexScore(state, seat, b) > vertexScore(state, seat, a) ? b : a))
    return { type: 'build', piece: step.building, at: best }
  }
  const t = topo(state)
  const roads = legalRoutes(state, seat, 'road', { anchor: setup.anchor })
  const ships = state.config.seafarers ? legalRoutes(state, seat, 'ship', { anchor: setup.anchor }) : []
  const options = [...roads.map((e) => ({ e, kind: 'road' as const })), ...ships.map((e) => ({ e, kind: 'ship' as const }))]
  if (!options.length) return null
  // Point the road at the better open corner beyond it.
  const value = ({ e }: { e: number }) => {
    const far = t.edges[e].a === setup.anchor ? t.edges[e].b : t.edges[e].a
    return Math.max(0, ...t.vertices[far].neighbors.filter((n) => openSpot(state, n)).map((n) => vertexScore(state, seat, n)))
  }
  const best = options.reduce((a, b) => (value(b) > value(a) ? b : a))
  return { type: 'build', piece: best.kind, at: best.e }
}

/* ------------------------------------------------------------------ *
 * Turns
 * ------------------------------------------------------------------ */

function preRoll(state: GameState, seat: number): Action | null {
  const player = state.players[seat]
  const t = topo(state)
  const robbed = state.robber >= 0 && t.hexes[state.robber].corners.some((v) => state.buildings[v]?.owner === seat)
  if (!state.config.citiesKnights && !state.turn.devPlayed && robbed &&
      player.dev.some((d) => d.type === 'knight' && d.bought < state.turn.number)) {
    return { type: 'playDev', card: 'knight' }
  }
  if (state.config.citiesKnights && player.progress.some((c) => c.type === 'alchemist')) {
    // Pick the total that pays us most, avoiding 7.
    let best = { a: 3, b: 3, value: -1 }
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        if (a + b === 7) continue
        let value = 0
        state.map.hexes.forEach((h, i) => {
          if (h.number !== a + b || i === state.robber) return
          for (const v of t.hexes[i].corners) {
            const bd = state.buildings[v]
            if (bd) value += (bd.owner === seat ? 1 : -0.4) * (bd.kind === 'city' ? 2 : 1)
          }
        })
        if (value > best.value) best = { a, b, value }
      }
    }
    if (best.value >= 3) return { type: 'playProgress', card: 'alchemist', a: best.a, b: best.b }
  }
  if (state.config.fishermen && robbed && state.robber >= 0) {
    const tokens = fishFor(state, seat, FISH_COSTS.robber)
    if (tokens) return { type: 'fish', use: 'robber', tokens }
  }
  return { type: 'roll' }
}

/** Token indices adding up to at least `cost`, spending as little as possible. */
function fishFor(state: GameState, seat: number, cost: number): number[] | null {
  const fish = state.players[seat].fish.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v)
  const total = fish.reduce((s, f) => s + f.v, 0)
  if (total < cost) return null
  const out: number[] = []
  let sum = 0
  for (const f of fish) {
    if (sum >= cost) break
    out.push(f.i)
    sum += f.v
  }
  return out
}

function ckMoves(state: GameState, seat: number): Action | null {
  const player = state.players[seat]
  const hand = player.hand
  const counts = pieceCounts(state, seat)
  const t = topo(state)

  // Improvements whenever affordable; science first for the aqueduct.
  for (const track of ['science', 'politics', 'trade'] as const) {
    if (!canImprove(state, seat, track)) return { type: 'improve', track }
  }

  // Defend against the barbarians when they are close.
  const barbarians = state.barbarian?.position ?? 0
  const defense = knightStrength(state)[seat]
  if (barbarians >= BARBARIAN_TRACK - 3 && defense < Math.max(1, counts.cities)) {
    const inactive = state.knights.findIndex((k) => k?.owner === seat && !k.active)
    if (inactive >= 0 && hasCards(hand, COSTS.activate)) return { type: 'activateKnight', at: inactive }
    const spots = legalKnights(state, seat)
    if (spots.length && hasCards(hand, COSTS.knight)) {
      const best = spots.reduce((a, b) => (vertexScore(state, seat, b) > vertexScore(state, seat, a) ? b : a))
      return { type: 'build', piece: 'knight', at: best }
    }
  }

  // Chase the robber off our own tiles.
  if (state.robber >= 0 && (state.barbarian?.attacks ?? 0) > 0) {
    const robbed = t.hexes[state.robber].corners.some((v) => state.buildings[v]?.owner === seat)
    if (robbed) {
      const chaser = t.hexes[state.robber].corners.find((v) => state.knights[v]?.owner === seat && !knightCanAct(state, seat, v))
      if (chaser !== undefined) return { type: 'chaseRobber', at: chaser }
    }
  }

  // Easy progress cards.
  const has = (type: string) => player.progress.some((c) => c.type === type)
  if (has('warlord') && state.knights.some((k) => k?.owner === seat && !k.active)) return { type: 'playProgress', card: 'warlord' }
  for (const card of ['irrigation', 'mining', 'resourceMonopoly', 'tradeMonopoly', 'roadBuilding', 'merchant', 'wedding', 'saboteur'] as const) {
    if (!has(card)) continue
    if (card === 'irrigation' || card === 'mining') {
      const terrain = card === 'irrigation' ? 'wheat' : 'ore'
      const any = state.map.hexes.some((h, i) => h.terrain === terrain && t.hexes[i].corners.some((v) => state.buildings[v]?.owner === seat))
      if (!any) continue
    }
    if (card === 'roadBuilding' && !routeTowardsBestSpot(state, seat)) continue
    if (card === 'wedding' && !state.players.some((_, i) => i !== seat && publicPoints(state, i) > publicPoints(state, seat))) continue
    if (card === 'saboteur' && !state.players.some((_, i) => i !== seat && publicPoints(state, i) >= publicPoints(state, seat))) continue
    if (card === 'merchant' && state.merchant?.owner === seat) continue
    return { type: 'playProgress', card }
  }
  if (has('smith') && state.knights.some((k, v) => k?.owner === seat && !canPromote(state, seat, v))) {
    return { type: 'playProgress', card: 'smith' }
  }
  return null
}

function mainMove(state: GameState, seat: number): Action | null {
  const player = state.players[seat]
  const hand = player.hand
  const stageKind = state.turn.stage.kind

  if (state.config.citiesKnights) {
    const ck = ckMoves(state, seat)
    if (ck) return ck
  }

  // Development cards (base game).
  if (!state.config.citiesKnights && stageKind !== 'specialBuild' && !state.turn.devPlayed) {
    const playable = (type: string) => player.dev.some((d) => d.type === type && d.bought < state.turn.number)
    if (playable('monopoly')) {
      const held = RESOURCES.map((r) => ({ r, n: state.players.reduce((s, p, i) => s + (i === seat ? 0 : p.hand[r]), 0) }))
      if (Math.max(...held.map((h) => h.n)) >= 3) return { type: 'playDev', card: 'monopoly' }
    }
    if (playable('yearOfPlenty') && !hasCards(hand, COSTS.city) && !hasCards(hand, COSTS.settlement)) {
      return { type: 'playDev', card: 'yearOfPlenty' }
    }
    if (playable('roadBuilding') && routeTowardsBestSpot(state, seat)) return { type: 'playDev', card: 'roadBuilding' }
    if (playable('knight')) {
      const t = topo(state)
      const robbed = state.robber >= 0 && t.hexes[state.robber].corners.some((v) => state.buildings[v]?.owner === seat)
      const armyClose = state.largestArmy?.owner !== seat && player.knightsPlayed + 1 >= Math.max(3, (state.largestArmy?.size ?? 0) + 1)
      if (robbed || armyClose) return { type: 'playDev', card: 'knight' }
    }
  }

  // Build: city, then settlement.
  const cities = legalCities(state, seat)
  if (cities.length && hasCards(hand, COSTS.city)) {
    const best = cities.reduce((a, b) => (vertexScore(state, seat, b) > vertexScore(state, seat, a) ? b : a))
    return { type: 'build', piece: 'city', at: best }
  }
  const spots = legalSettlements(state, seat)
  if (spots.length && hasCards(hand, COSTS.settlement)) {
    const best = spots.reduce((a, b) => (vertexScore(state, seat, b) > vertexScore(state, seat, a) ? b : a))
    return { type: 'build', piece: 'settlement', at: best }
  }

  // Seafarers: sail a loose ship towards somewhere useful.
  if (state.config.seafarers && !state.turn.shipMoved && stageKind !== 'specialBuild') {
    const move = shipMove(state, seat)
    if (move) return move
  }

  // Head for the next settlement spot.
  const tradesSoFar = state.turn.bankTrades ?? 0
  const step = spots.length === 0 ? routeTowardsBestSpot(state, seat) : null
  if (step && hasCards(hand, COSTS[step.kind])) return { type: 'build', piece: step.kind, at: step.edge }

  // Save up, trading spare cards with the bank.
  if (stageKind !== 'specialBuild' && tradesSoFar < 4) {
    const goals: Goal[] = []
    if (cities.length) goals.push('city')
    if (spots.length) goals.push('settlement')
    if (step) goals.push(step.kind)
    if (!state.config.citiesKnights && state.devDeck.length) goals.push('dev')
    for (const goal of goals) {
      const cost = goalCost(goal)
      if (hasCards(hand, cost)) break
      if (!reachableByTrade(state, seat, cost)) continue
      const trade = bankTradeFor(state, seat, cost)
      if (trade) return trade
    }
  }

  if (!state.config.citiesKnights && state.devDeck.length && hasCards(hand, COSTS.dev) && !cities.length) {
    return { type: 'buyDev' }
  }
  if (state.config.citiesKnights) {
    const inactive = state.knights.findIndex((k) => k?.owner === seat && !k.active)
    if (inactive >= 0 && hand.wheat >= 2) return { type: 'activateKnight', at: inactive }
    if (hand.brick >= 4) {
      const wallAt = state.buildings.findIndex((b) => b?.owner === seat && b.kind === 'city' && !b.wall)
      if (wallAt >= 0 && supplyLeft(state, seat).wall > 0) return { type: 'build', piece: 'wall', at: wallAt }
    }
  }

  // Fishermen: spend a big catch.
  if (state.config.fishermen && stageKind !== 'specialBuild') {
    const total = player.fish.reduce((s, f) => s + f, 0)
    if (total >= FISH_COSTS.dev && !state.config.citiesKnights && state.devDeck.length) {
      return { type: 'fish', use: 'dev', tokens: fishFor(state, seat, FISH_COSTS.dev)! }
    }
    if (total >= FISH_COSTS.resource) return { type: 'fish', use: 'resource', tokens: fishFor(state, seat, FISH_COSTS.resource)! }
  }

  return { type: 'endTurn' }
}

function shipMove(state: GameState, seat: number): Action | null {
  const t = topo(state)
  const loose = state.routes.flatMap((r, e) => (r?.owner === seat && r.kind === 'ship' && shipCanMove(state, seat, e) ? [e] : []))
  for (const from of loose) {
    // Only bother if the ship leads nowhere: no open corner within reach of either end.
    const ends = [t.edges[from].a, t.edges[from].b]
    if (ends.some((v) => openSpot(state, v))) continue
    const ship = state.routes[from]!
    state.routes[from] = null
    const step = routeTowardsBestSpot(state, seat)
    state.routes[from] = ship
    if (step && step.kind === 'ship' && step.edge !== from) {
      const probe = structuredClone(state)
      probe.routes[from] = null
      if (canPlaceRoute(probe, seat, step.edge, 'ship')) return { type: 'moveShip', from, to: step.edge }
    }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Trade offers
 * ------------------------------------------------------------------ */

function offerMove(state: GameState, seat: number): Action | null {
  for (const o of state.offers) {
    if (o.from === seat) {
      if (o.accepted.length) return { type: 'offerConfirm', id: o.id, with: o.accepted[0] }
      if (o.rejected.length === o.to.length) return { type: 'offerCancel', id: o.id }
      continue
    }
    if (!o.to.includes(seat) || o.accepted.includes(seat) || o.rejected.includes(seat)) continue
    const hand = state.players[seat].hand
    const want = wanted(state, seat).slice(0, 3)
    const gets = Object.keys(o.give).filter((c) => (o.give[c as Card] ?? 0) > 0) as Card[]
    const gives = Object.keys(o.get).filter((c) => (o.get[c as Card] ?? 0) > 0) as Card[]
    const affordable = hasCards(hand, o.get)
    const helpful = gets.some((c) => want.includes(c))
    const cheap = gives.every((c) => !want.includes(c) || hand[c] > 2)
    const fair = countOf(o.give) >= countOf(o.get)
    const leaderClose = totalPoints(state, o.from) >= state.config.vpTarget - 2
    return { type: 'offerRespond', id: o.id, accept: affordable && helpful && cheap && fair && !leaderClose }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Entry points
 * ------------------------------------------------------------------ */

/** The next thing a bot in `seat` wants to do, or null if it is waiting. */
export function botAction(state: GameState, seat: number): Action | null {
  if (state.phase === 'ended' || state.players[seat].resigned) return null
  const prompt = activePrompts(state).find((p) => p.seat === seat)
  if (prompt) return respondTo(state, seat, prompt)
  if (activePrompts(state).length) return null
  const offers = offerMove(state, seat)
  if (offers) return offers
  if (actingSeat(state) !== seat) return null
  if (state.phase === 'setup') return setupMove(state, seat)
  if (state.turn.stage.kind === 'main' && !state.turn.rolled) return preRoll(state, seat)
  return mainMove(state, seat)
}

/**
 * The minimum for a player whose clock ran out: answer what is asked,
 * place opening pieces sensibly, roll, and pass.
 */
export function autopilot(state: GameState, seat: number): Action | null {
  const prompt = activePrompts(state).find((p) => p.seat === seat)
  if (prompt) return respondTo(state, seat, prompt)
  if (actingSeat(state) !== seat) return null
  if (state.phase === 'setup') return setupMove(state, seat)
  if (state.turn.stage.kind === 'main' && !state.turn.rolled) return { type: 'roll' }
  return { type: 'endTurn' }
}

export { respondTo as botRespond }
