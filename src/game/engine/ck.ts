/**
 * Cities & Knights: commodities, city improvements and metropolises, knights,
 * the barbarian fleet, and the 54 progress cards.
 *
 * Interactive cards are built from the same prompts as everything else — a
 * card picker, a board picker or a list of choices — so the UI needs no
 * special screen for any of them.
 */
import { BARBARIAN_TRACK, PROGRESS_HAND_LIMIT } from './config'
import type { ActionHandler, PromptHandler, TaskHandler } from './game'
import {
  canPlaceKnight,
  canPlaceRoute,
  knightReach,
  legalRoutes,
  vertexOnNetwork,
} from './placement'
import { robberPrompt, task, turnHolder } from './rules'
import { shuffle, type Rng } from './rng'
import {
  COSTS,
  TRACK_COMMODITY,
  addCards,
  cardName,
  countOf,
  describeCards,
  handSize,
  isResource,
  log,
  makePrompt,
  nameOf,
  othersInOrder,
  pay,
  pieceCounts,
  publicPoints,
  pushFront,
  removeCards,
  supplyLeft,
  topo,
} from './state'
import {
  CARDS,
  COMMODITIES,
  RESOURCES,
  RuleError,
  TRACKS,
  type Action,
  type Card,
  type CardCounts,
  type GameState,
  type Prompt,
  type ProgressCardType,
  type Track,
} from './types'

/* ------------------------------------------------------------------ *
 * Decks
 * ------------------------------------------------------------------ */

export const PROGRESS_CARDS: Record<Track, Partial<Record<ProgressCardType, number>>> = {
  science: {
    alchemist: 2, crane: 2, engineer: 1, inventor: 2, irrigation: 2,
    medicine: 2, mining: 2, printer: 1, roadBuilding: 2, smith: 2,
  },
  trade: {
    commercialHarbor: 2, masterMerchant: 2, merchant: 6, merchantFleet: 2,
    resourceMonopoly: 4, tradeMonopoly: 2,
  },
  politics: {
    bishop: 2, constitution: 1, deserter: 2, diplomat: 2, intrigue: 2,
    saboteur: 2, spy: 3, warlord: 2, wedding: 2,
  },
}

export const PROGRESS_INFO: Record<ProgressCardType, { title: string; text: string }> = {
  alchemist: { title: 'Alchemist', text: 'Play before rolling: choose the numbers on both production dice.' },
  crane: { title: 'Crane', text: 'Your next city improvement this turn costs one commodity less.' },
  engineer: { title: 'Engineer', text: 'Build a city wall for free.' },
  inventor: { title: 'Inventor', text: 'Swap two number tokens (not 2, 12, 6 or 8).' },
  irrigation: { title: 'Irrigation', text: 'Take 2 grain for each fields tile beside your buildings.' },
  medicine: { title: 'Medicine', text: 'Upgrade a settlement to a city for 2 ore and 1 grain.' },
  mining: { title: 'Mining', text: 'Take 2 ore for each mountains tile beside your buildings.' },
  printer: { title: 'Printer', text: '1 victory point, revealed at once.' },
  roadBuilding: { title: 'Road Building', text: 'Build two roads (or ships) for free.' },
  smith: { title: 'Smith', text: 'Promote up to two knights for free.' },
  commercialHarbor: { title: 'Commercial Harbor', text: 'Give each opponent a resource; each gives you a commodity back.' },
  masterMerchant: { title: 'Master Merchant', text: 'Look at the hand of a player with more points and take two cards.' },
  merchant: { title: 'Merchant', text: 'Place the merchant beside your buildings: trade its resource 2:1, and hold 1 point.' },
  merchantFleet: { title: 'Merchant Fleet', text: 'This turn, trade one resource or commodity 2:1 with the bank.' },
  resourceMonopoly: { title: 'Resource Monopoly', text: 'Name a resource: every opponent gives you up to 2 of it.' },
  tradeMonopoly: { title: 'Trade Monopoly', text: 'Name a commodity: every opponent gives you 1 of it.' },
  bishop: { title: 'Bishop', text: 'Move the robber and steal a card from everyone beside it.' },
  constitution: { title: 'Constitution', text: '1 victory point, revealed at once.' },
  deserter: { title: 'Deserter', text: 'An opponent removes a knight; you may place one of the same strength.' },
  diplomat: { title: 'Diplomat', text: 'Remove an open road. If it was yours, you may rebuild it for free.' },
  intrigue: { title: 'Intrigue', text: "Displace an opponent's knight standing on one of your roads." },
  saboteur: { title: 'Saboteur', text: 'Everyone with as many points as you or more discards half their hand.' },
  spy: { title: 'Spy', text: "Look at an opponent's progress cards and take one." },
  warlord: { title: 'Warlord', text: 'Activate all of your knights for free.' },
  wedding: { title: 'Wedding', text: 'Everyone with more points than you gives you two cards of their choice.' },
}

const VP_CARDS: ProgressCardType[] = ['printer', 'constitution']

export function progressDeck(rng: Rng): Record<Track, ProgressCardType[]> {
  const out = {} as Record<Track, ProgressCardType[]>
  for (const track of TRACKS) {
    const cards = Object.entries(PROGRESS_CARDS[track]).flatMap(([type, n]) =>
      Array<ProgressCardType>(n!).fill(type as ProgressCardType),
    )
    out[track] = shuffle(rng, cards)
  }
  return out
}

export const trackOf = (type: ProgressCardType): Track =>
  TRACKS.find((t) => PROGRESS_CARDS[t][type] !== undefined)!

export const progressOverLimit = (state: GameState, seat: number) =>
  state.players[seat].progress.length > PROGRESS_HAND_LIMIT

export function progressLimitPrompts(state: GameState, seat: number): Prompt[] {
  const cards = state.players[seat].progress
  return [makePrompt(state, {
    seat,
    type: 'progressDiscard',
    text: `You may hold ${PROGRESS_HAND_LIMIT} progress cards: discard one`,
    input: {
      kind: 'choice',
      options: cards.map((c, i) => ({ id: String(i), label: PROGRESS_INFO[c.type].title })),
    },
  })]
}

/** Draw a progress card for a seat, revealing victory point cards at once. */
function drawProgress(state: GameState, seat: number, track: Track) {
  const deck = state.progressDecks[track]
  const type = deck.shift()
  if (!type) return
  const player = state.players[seat]
  if (VP_CARDS.includes(type)) {
    player.progressPoints++
    log(state, seat, `${player.name} draws the ${PROGRESS_INFO[type].title}: +1 VP`)
    return
  }
  player.progress.push({ type, track })
  log(state, seat, `${player.name} draws a ${track} progress card`, {
    secret: { seats: [seat], text: PROGRESS_INFO[type].title },
  })
  // Off-turn, an over-full hand has to be trimmed straight away.
  const asked = state.queue.some((s) => s.kind === 'prompt' && s.type === 'progressDiscard' && s.seat === seat)
  if (seat !== state.turn.seat && progressOverLimit(state, seat) && !asked) {
    pushFront(state, ...progressLimitPrompts(state, seat))
  }
}

/* ------------------------------------------------------------------ *
 * Barbarians
 * ------------------------------------------------------------------ */

const barbarianAdvance: TaskHandler = (state) => {
  const b = state.barbarian!
  b.position++
  if (b.position >= BARBARIAN_TRACK) {
    log(state, null, 'The barbarians land!')
    pushFront(state, task('barbarianAttack'))
  } else {
    log(state, null, `The barbarian ship sails closer (${BARBARIAN_TRACK - b.position} to go)`)
  }
}

/** Active knight strength per seat. */
export function knightStrength(state: GameState): number[] {
  const out = state.players.map(() => 0)
  for (const k of state.knights) if (k && k.active) out[k.owner] += k.level
  return out
}

const barbarianAttack: TaskHandler = (state) => {
  const b = state.barbarian!
  const standing = state.players.map((p) => !p.resigned)
  const cities = state.players.map((_, i) => pieceCounts(state, i).cities)
  const strength = cities.reduce((s, c, i) => s + (standing[i] ? c : 0), 0)
  const defense = knightStrength(state)
  const total = defense.reduce((s, d, i) => s + (standing[i] ? d : 0), 0)
  const prompts: Prompt[] = []

  if (strength === 0) {
    log(state, null, 'With no cities to plunder, the barbarians sail away')
  } else if (total >= strength) {
    log(state, null, `Catan holds! ${total} knight strength against ${strength} barbarians`)
    const contenders = defense.map((d, i) => (standing[i] ? d : -1))
    const top = Math.max(...contenders)
    const leaders = contenders.flatMap((d, i) => (d === top && d > 0 ? [i] : []))
    if (leaders.length === 1) {
      state.players[leaders[0]].defenderPoints++
      log(state, leaders[0], `${nameOf(state, leaders[0])} is the Defender of Catan: +1 VP`)
    } else {
      const group = `defender-${state.seq}`
      for (const seat of leaders) {
        const options = TRACKS.filter((t) => state.progressDecks[t].length > 0)
        if (!options.length) continue
        prompts.push(makePrompt(state, {
          group,
          seat,
          type: 'defenderPick',
          text: 'Shared defence of Catan: choose a progress card deck',
          input: { kind: 'choice', options: options.map((t) => ({ id: t, label: t[0].toUpperCase() + t.slice(1) })) },
        }))
      }
    }
  } else {
    log(state, null, `The barbarians win: ${total} knight strength against ${strength}`)
    // Only players with a city that isn't a metropolis can lose one.
    const exposed = state.players.flatMap((_, i) =>
      standing[i] && state.buildings.some((bd) => bd && bd.owner === i && bd.kind === 'city' && !bd.metropolis) ? [i] : [],
    )
    if (exposed.length) {
      const low = Math.min(...exposed.map((i) => defense[i]))
      const group = `pillage-${state.seq}`
      for (const seat of exposed.filter((i) => defense[i] === low)) {
        const targets = state.buildings.flatMap((bd, v) =>
          bd && bd.owner === seat && bd.kind === 'city' && !bd.metropolis ? [v] : [],
        )
        if (targets.length === 1) pillage(state, seat, targets[0])
        else {
          prompts.push(makePrompt(state, {
            group,
            seat,
            type: 'cityLoss',
            text: 'The barbarians sack one of your cities: choose which',
            input: { kind: 'board', vertices: targets },
          }))
        }
      }
    }
  }

  for (const k of state.knights) if (k) k.active = false
  b.position = 0
  b.attacks++
  if (b.attacks === 1) log(state, null, 'The robber is now free to roam')
  if (prompts.length) pushFront(state, ...prompts)
}

function pillage(state: GameState, seat: number, vertex: number) {
  const b = state.buildings[vertex]!
  state.buildings[vertex] = { owner: b.owner, kind: 'settlement' }
  log(state, seat, `${nameOf(state, seat)}'s city is reduced to a settlement`)
}

const progressDraw: TaskHandler = (state, data) => {
  const track = data.track as Track
  const red = data.red as number
  const order = [state.turn.seat, ...othersInOrder(state, state.turn.seat)]
  for (const seat of order) {
    const level = state.players[seat].improvements[track]
    if (level > 0 && red <= level + 1) drawProgress(state, seat, track)
  }
}

const commercialHarbor: TaskHandler = (state, data) => {
  const targets = (data.targets as number[]).filter((s) => COMMODITIES.some((c) => state.players[s].hand[c] > 0))
  const seat = data.seat as number
  if (targets.length === 0) return
  if (!RESOURCES.some((r) => state.players[seat].hand[r] > 0)) return
  const [victim, ...rest] = targets
  pushFront(
    state,
    makePrompt(state, {
      seat,
      type: 'commercialHarborGive',
      text: `Commercial Harbor: give ${nameOf(state, victim)} a resource`,
      input: { kind: 'cards', count: 1, source: 'hand', allowed: [...RESOURCES] },
      optional: true,
      data: { victim },
    }),
    task('commercialHarbor', { seat, targets: rest }),
  )
}

export const ckTasks: Record<string, TaskHandler> = {
  barbarianAdvance,
  barbarianAttack,
  progressDraw,
  commercialHarbor,
}

/* ------------------------------------------------------------------ *
 * Improvements and metropolises
 * ------------------------------------------------------------------ */

function citiesWithoutMetropolis(state: GameState, seat: number): number[] {
  return state.buildings.flatMap((b, v) => (b && b.owner === seat && b.kind === 'city' && !b.metropolis ? [v] : []))
}

export function improvementCost(state: GameState, seat: number, track: Track): number {
  const level = state.players[seat].improvements[track]
  return Math.max(0, level + 1 - (state.turn.crane && turnHolder(state) === seat ? 1 : 0))
}

export function canImprove(state: GameState, seat: number, track: Track): string | null {
  const player = state.players[seat]
  const level = player.improvements[track]
  if (level >= 5) return 'already at the top'
  if (pieceCounts(state, seat).cities === 0) return 'you need a city first'
  const holder = state.metropolis[track] === null ? null : state.buildings[state.metropolis[track]!]?.owner ?? null
  if (level + 1 >= 4 && holder !== seat && citiesWithoutMetropolis(state, seat).length === 0) {
    return 'you need a city to hold the metropolis'
  }
  const commodity = TRACK_COMMODITY[track]
  if (player.hand[commodity] < improvementCost(state, seat, track)) return `you need ${improvementCost(state, seat, track)} ${commodity}`
  return null
}

function placeMetropolis(state: GameState, seat: number, track: Track, vertex: number) {
  const old = state.metropolis[track]
  if (old !== null && state.buildings[old]) delete state.buildings[old]!.metropolis
  state.buildings[vertex]!.metropolis = track
  state.metropolis[track] = vertex
  log(state, seat, `${nameOf(state, seat)} builds the ${track} metropolis: +2 VP`)
}

function claimMetropolis(state: GameState, seat: number, track: Track) {
  const spots = citiesWithoutMetropolis(state, seat)
  if (spots.length === 0) return
  if (spots.length === 1) placeMetropolis(state, seat, track, spots[0])
  else {
    pushFront(state, makePrompt(state, {
      seat,
      type: 'metropolis',
      text: `Choose a city for your ${track} metropolis`,
      input: { kind: 'board', vertices: spots },
      data: { track },
    }))
  }
}

const improve: ActionHandler = (state, seat, action) => {
  const { track } = action as Extract<Action, { type: 'improve' }>
  if (!TRACKS.includes(track)) throw new RuleError('no such improvement')
  requireRolledMain(state)
  const problem = canImprove(state, seat, track)
  if (problem) throw new RuleError(problem)
  const cost = improvementCost(state, seat, track)
  pay(state, seat, { [TRACK_COMMODITY[track]]: cost })
  state.turn.crane = false
  const player = state.players[seat]
  player.improvements[track]++
  const level = player.improvements[track]
  log(state, seat, `${player.name} improves ${track} to level ${level}`)
  const holderVertex = state.metropolis[track]
  const holder = holderVertex === null ? null : state.buildings[holderVertex]?.owner ?? null
  if (level === 4 && holder === null) claimMetropolis(state, seat, track)
  if (level === 5 && holder !== null && holder !== seat && state.players[holder].improvements[track] < 5) {
    claimMetropolis(state, seat, track)
  }
}

/* ------------------------------------------------------------------ *
 * Knights
 * ------------------------------------------------------------------ */

function requireRolledMain(state: GameState) {
  if (state.turn.stage.kind === 'main' && !state.turn.rolled) throw new RuleError('roll the dice first')
}

function ownKnight(state: GameState, seat: number, at: number) {
  const k = state.knights[at]
  if (!k || k.owner !== seat) throw new RuleError('that is not your knight')
  return k
}

const buildKnight: ActionHandler = (state, seat, action) => {
  const at = (action as Extract<Action, { type: 'build' }>).at
  if (!state.config.citiesKnights) throw new RuleError('knights need Cities & Knights')
  if (!canPlaceKnight(state, seat, at)) throw new RuleError("you can't raise a knight there")
  pay(state, seat, COSTS.knight)
  state.knights[at] = { owner: seat, level: 1, active: false }
  log(state, seat, `${nameOf(state, seat)} raises a knight`)
}

const activateKnight: ActionHandler = (state, seat, action) => {
  const { at } = action as Extract<Action, { type: 'activateKnight' }>
  requireRolledMain(state)
  const k = ownKnight(state, seat, at)
  if (k.active) throw new RuleError('that knight is already active')
  pay(state, seat, COSTS.activate)
  k.active = true
  k.activated = state.turn.number
  log(state, seat, `${nameOf(state, seat)} activates a knight`)
}

export function canPromote(state: GameState, seat: number, at: number): string | null {
  const k = state.knights[at]
  if (!k || k.owner !== seat) return 'that is not your knight'
  if (k.level >= 3) return 'already mighty'
  if (k.level === 2 && state.players[seat].improvements.politics < 3) return 'mighty knights need a fortress (politics 3)'
  if (k.promoted === state.turn.number) return 'a knight can be promoted once a turn'
  if (supplyLeft(state, seat).knight[k.level + 1] <= 0) return 'no knights of that strength left'
  return null
}

function promote(state: GameState, seat: number, at: number) {
  const k = state.knights[at]!
  k.level = (k.level + 1) as 2 | 3
  k.promoted = state.turn.number
  log(state, seat, `${nameOf(state, seat)} promotes a knight to ${k.level === 2 ? 'strong' : 'mighty'}`)
}

const promoteKnight: ActionHandler = (state, seat, action) => {
  const { at } = action as Extract<Action, { type: 'promoteKnight' }>
  requireRolledMain(state)
  const problem = canPromote(state, seat, at)
  if (problem) throw new RuleError(problem)
  pay(state, seat, COSTS.promote)
  promote(state, seat, at)
}

/** Corners a displaced knight could retreat to. */
function retreats(state: GameState, seat: number, from: number): number[] {
  return [...knightReach(state, seat, from)].filter((v) => !state.knights[v] && !state.buildings[v])
}

function displace(state: GameState, victimVertex: number, knight: NonNullable<GameState['knights'][number]>) {
  const seat = knight.owner
  const spots = retreats(state, seat, victimVertex)
  if (spots.length === 0) {
    log(state, seat, `${nameOf(state, seat)}'s knight has nowhere to go and leaves the board`)
    return
  }
  pushFront(state, makePrompt(state, {
    seat,
    type: 'displaced',
    text: 'Your knight was displaced: move it along your roads',
    input: { kind: 'board', vertices: spots },
    data: { knight },
  }))
}

export function knightCanAct(state: GameState, seat: number, at: number): string | null {
  const k = state.knights[at]
  if (!k || k.owner !== seat) return 'that is not your knight'
  if (!k.active) return 'only an active knight can act'
  if (k.activated === state.turn.number) return 'a knight activated this turn has to wait'
  return null
}

export function knightMoves(state: GameState, seat: number, at: number): number[] {
  if (knightCanAct(state, seat, at)) return []
  const k = state.knights[at]!
  return [...knightReach(state, seat, at)].filter((v) => {
    const other = state.knights[v]
    return !other || (other.owner !== seat && other.level < k.level)
  })
}

/** The special build phase is for building only. */
function requireNotSpecialBuild(state: GameState) {
  if (state.turn.stage.kind === 'specialBuild') throw new RuleError('the special build phase is for building only')
}

const moveKnight: ActionHandler = (state, seat, action) => {
  const { from, to } = action as Extract<Action, { type: 'moveKnight' }>
  requireRolledMain(state)
  requireNotSpecialBuild(state)
  const problem = knightCanAct(state, seat, from)
  if (problem) throw new RuleError(problem)
  if (!knightMoves(state, seat, from).includes(to)) throw new RuleError("the knight can't reach there")
  const k = state.knights[from]!
  const victim = state.knights[to]
  state.knights[from] = null
  state.knights[to] = { ...k, active: false, acted: state.turn.number }
  if (victim) {
    log(state, seat, `${nameOf(state, seat)}'s knight displaces ${nameOf(state, victim.owner)}'s`)
    displace(state, to, victim)
  } else {
    log(state, seat, `${nameOf(state, seat)} moves a knight`)
  }
}

const chaseRobber: ActionHandler = (state, seat, action) => {
  const { at } = action as Extract<Action, { type: 'chaseRobber' }>
  requireRolledMain(state)
  requireNotSpecialBuild(state)
  const problem = knightCanAct(state, seat, at)
  if (problem) throw new RuleError(problem)
  if ((state.barbarian?.attacks ?? 0) === 0) throw new RuleError('the robber is asleep until the barbarians first land')
  const t = topo(state)
  if (!t.vertices[at].hexes.includes(state.robber)) throw new RuleError('the knight must stand beside the robber')
  const k = state.knights[at]!
  k.active = false
  k.acted = state.turn.number
  log(state, seat, `${nameOf(state, seat)}'s knight chases the robber away`)
  pushFront(state, robberPrompt(state, seat, 'chase'))
}

/* ------------------------------------------------------------------ *
 * Progress cards
 * ------------------------------------------------------------------ */

const opponents = (state: GameState, seat: number) => othersInOrder(state, seat)

/** Roads with an end that touches nothing else of their owner's. */
export function openRoads(state: GameState): number[] {
  const t = topo(state)
  return state.routes.flatMap((r, e) => {
    if (!r || r.kind !== 'road') return []
    const open = [t.edges[e].a, t.edges[e].b].some((v) => {
      const b = state.buildings[v]
      if (b && b.owner === r.owner) return false
      return !t.vertices[v].edges.some((o) => o !== e && state.routes[o]?.owner === r.owner)
    })
    return open ? [e] : []
  })
}

function adjacentTerrainHexes(state: GameState, seat: number, terrain: string): number[] {
  const t = topo(state)
  return state.map.hexes.flatMap((h, i) =>
    h.terrain === terrain && h.veil !== 'fog' && t.hexes[i].corners.some((v) => state.buildings[v]?.owner === seat) ? [i] : [],
  )
}

function giveFromBank(state: GameState, seat: number, card: Card, n: number): number {
  const got = Math.min(n, state.bank[card])
  state.bank[card] -= got
  state.players[seat].hand[card] += got
  return got
}

const playProgress: ActionHandler = (state, seat, action, ctx) => {
  const { card, a, b } = action as Extract<Action, { type: 'playProgress' }>
  const player = state.players[seat]
  if (state.turn.stage.kind === 'specialBuild') throw new RuleError('no progress cards in the special build phase')
  const index = player.progress.findIndex((c) => c.type === card)
  if (index < 0) throw new RuleError("you don't have that card")
  if (card === 'alchemist') {
    if (state.turn.rolled || state.turn.stage.kind !== 'main') throw new RuleError('the Alchemist is played before rolling')
  } else if (!state.turn.rolled) {
    throw new RuleError('roll the dice first; only the Alchemist comes before')
  }

  const title = PROGRESS_INFO[card].title
  const spend = () => {
    player.progress.splice(index, 1)
    state.progressDecks[trackOf(card)].push(card)
    log(state, seat, `${player.name} plays ${title}`)
  }

  switch (card) {
    case 'alchemist': {
      if (!Number.isInteger(a) || !Number.isInteger(b) || a! < 1 || a! > 6 || b! < 1 || b! > 6) {
        throw new RuleError('choose both dice, 1 to 6')
      }
      spend()
      state.turn.alchemist = { a: a!, b: b! }
      return
    }
    case 'crane':
      spend()
      state.turn.crane = true
      return
    case 'engineer': {
      const spots = state.buildings.flatMap((bd, v) => (bd && bd.owner === seat && bd.kind === 'city' && !bd.wall ? [v] : []))
      if (!spots.length || supplyLeft(state, seat).wall <= 0) throw new RuleError('you have no city that can take a wall')
      spend()
      pushFront(state, makePrompt(state, {
        seat, type: 'engineer', text: 'Engineer: choose a city for a free wall',
        input: { kind: 'board', vertices: spots },
      }))
      return
    }
    case 'inventor': {
      const hexes = state.map.hexes.flatMap((h, i) =>
        h.number !== undefined && h.veil !== 'fog' && ![2, 12, 6, 8].includes(h.number) ? [i] : [],
      )
      if (hexes.length < 2) throw new RuleError('there are no two numbers to swap')
      spend()
      pushFront(state, makePrompt(state, {
        seat, type: 'inventor', text: 'Inventor: choose two number tokens to swap',
        input: { kind: 'board', hexes, count: 2 },
      }))
      return
    }
    case 'irrigation':
    case 'mining': {
      const terrain = card === 'irrigation' ? 'wheat' : 'ore'
      spend()
      const got = giveFromBank(state, seat, terrain, 2 * adjacentTerrainHexes(state, seat, terrain).length)
      log(state, seat, `${player.name} takes ${got} ${cardName(terrain)}`)
      return
    }
    case 'medicine': {
      const spots = state.buildings.flatMap((bd, v) => (bd && bd.owner === seat && bd.kind === 'settlement' ? [v] : []))
      if (!spots.length || supplyLeft(state, seat).city <= 0) throw new RuleError('you have no settlement to upgrade')
      if (player.hand.ore < 2 || player.hand.wheat < 1) throw new RuleError('Medicine still costs 2 ore and 1 grain')
      spend()
      pushFront(state, makePrompt(state, {
        seat, type: 'medicine', text: 'Medicine: choose a settlement to upgrade',
        input: { kind: 'board', vertices: spots },
      }))
      return
    }
    case 'roadBuilding': {
      const edges = [...legalRoutes(state, seat, 'road'), ...(state.config.seafarers ? legalRoutes(state, seat, 'ship') : [])]
      if (!edges.length) throw new RuleError('there is nowhere to build')
      spend()
      pushFront(state, task('freeRoads', { seat, left: 2, reason: 'Road Building' }))
      return
    }
    case 'smith': {
      if (!state.knights.some((k, v) => k?.owner === seat && !canPromote(state, seat, v))) {
        throw new RuleError('none of your knights can be promoted')
      }
      spend()
      pushFront(state, smithPrompt(state, seat, 2)!)
      return
    }
    case 'commercialHarbor': {
      spend()
      pushFront(state, task('commercialHarbor', { seat, targets: opponents(state, seat) }))
      return
    }
    case 'masterMerchant': {
      const mine = publicPoints(state, seat)
      const targets = opponents(state, seat).filter((o) => publicPoints(state, o) > mine && handSize(state.players[o].hand) > 0)
      if (!targets.length) throw new RuleError('nobody with more points has cards')
      spend()
      pushFront(state, makePrompt(state, {
        seat, type: 'masterMerchantSeat', text: 'Master Merchant: whose hand do you look at?',
        input: { kind: 'choice', options: targets.map((o) => ({ id: String(o), label: nameOf(state, o) })) },
      }))
      return
    }
    case 'merchant': {
      const t = topo(state)
      const hexes = state.map.hexes.flatMap((h, i) =>
        isResource(h.terrain) && h.veil !== 'fog' && t.hexes[i].corners.some((v) => state.buildings[v]?.owner === seat) ? [i] : [],
      )
      if (!hexes.length) throw new RuleError('the merchant must stand beside one of your buildings')
      spend()
      pushFront(state, makePrompt(state, {
        seat, type: 'merchantPlace', text: 'Merchant: choose a tile beside your buildings',
        input: { kind: 'board', hexes },
      }))
      return
    }
    case 'merchantFleet': {
      spend()
      pushFront(state, makePrompt(state, {
        seat, type: 'merchantFleet', text: 'Merchant Fleet: which card trades 2:1 this turn?',
        input: { kind: 'choice', options: CARDS.map((c) => ({ id: c, label: cardName(c) })) },
      }))
      return
    }
    case 'resourceMonopoly':
    case 'tradeMonopoly': {
      spend()
      const list = card === 'resourceMonopoly' ? RESOURCES : COMMODITIES
      pushFront(state, makePrompt(state, {
        seat, type: card, text: `${title}: name a ${card === 'resourceMonopoly' ? 'resource' : 'commodity'}`,
        input: { kind: 'choice', options: list.map((c) => ({ id: c, label: cardName(c) })) },
      }))
      return
    }
    case 'bishop': {
      if ((state.barbarian?.attacks ?? 0) === 0) throw new RuleError('the robber is asleep until the barbarians first land')
      spend()
      pushFront(state, robberPrompt(state, seat, 'bishop'))
      return
    }
    case 'deserter': {
      const targets = opponents(state, seat).filter((o) => state.knights.some((k) => k?.owner === o))
      if (!targets.length) throw new RuleError('nobody else has a knight')
      spend()
      pushFront(state, makePrompt(state, {
        seat, type: 'deserterSeat', text: 'Deserter: whose knight deserts?',
        input: { kind: 'choice', options: targets.map((o) => ({ id: String(o), label: nameOf(state, o) })) },
      }))
      return
    }
    case 'diplomat': {
      const edges = openRoads(state)
      if (!edges.length) throw new RuleError('there are no open roads')
      spend()
      pushFront(state, makePrompt(state, {
        seat, type: 'diplomatRemove', text: 'Diplomat: choose an open road to remove',
        input: { kind: 'board', edges },
      }))
      return
    }
    case 'intrigue': {
      const t = topo(state)
      const vertices = state.knights.flatMap((k, v) =>
        k && k.owner !== seat && t.vertices[v].edges.some((e) => state.routes[e]?.owner === seat) ? [v] : [],
      )
      if (!vertices.length) throw new RuleError("no opponent's knight stands on your roads")
      spend()
      pushFront(state, makePrompt(state, {
        seat, type: 'intrigue', text: 'Intrigue: choose a knight to displace',
        input: { kind: 'board', vertices },
      }))
      return
    }
    case 'saboteur': {
      spend()
      const mine = publicPoints(state, seat)
      const group = `saboteur-${state.seq}`
      const prompts = opponents(state, seat).flatMap((o) => {
        const size = handSize(state.players[o].hand)
        if (publicPoints(state, o) < mine || size < 2) return []
        const count = Math.floor(size / 2)
        return [makePrompt(state, {
          group, seat: o, type: 'discard', text: `Saboteur: discard ${count} card${count > 1 ? 's' : ''}`,
          input: { kind: 'cards', count, source: 'hand' },
        })]
      })
      if (prompts.length) pushFront(state, ...prompts)
      return
    }
    case 'spy': {
      const targets = opponents(state, seat).filter((o) => state.players[o].progress.length > 0)
      if (!targets.length) throw new RuleError('nobody has progress cards')
      spend()
      pushFront(state, makePrompt(state, {
        seat, type: 'spySeat', text: 'Spy: whose progress cards do you look at?',
        input: { kind: 'choice', options: targets.map((o) => ({ id: String(o), label: nameOf(state, o) })) },
      }))
      return
    }
    case 'warlord': {
      spend()
      let n = 0
      for (const k of state.knights) {
        if (k && k.owner === seat && !k.active) {
          k.active = true
          k.activated = state.turn.number
          n++
        }
      }
      log(state, seat, `${player.name} activates ${n} knight${n === 1 ? '' : 's'}`)
      return
    }
    case 'wedding': {
      spend()
      const mine = publicPoints(state, seat)
      const group = `wedding-${state.seq}`
      const prompts = opponents(state, seat).flatMap((o) => {
        const size = handSize(state.players[o].hand)
        if (publicPoints(state, o) <= mine || size === 0) return []
        const count = Math.min(2, size)
        return [makePrompt(state, {
          group, seat: o, type: 'wedding', text: `Wedding: give ${nameOf(state, seat)} ${count} card${count > 1 ? 's' : ''}`,
          input: { kind: 'cards', count, source: 'hand' },
          data: { to: seat },
        })]
      })
      if (prompts.length) pushFront(state, ...prompts)
      return
    }
    default:
      void ctx
      throw new RuleError(`${title} can't be played`)
  }
}

function smithPrompt(state: GameState, seat: number, left: number): Prompt | null {
  const vertices = state.knights.flatMap((k, v) => (k && k.owner === seat && !canPromote(state, seat, v) ? [v] : []))
  if (!vertices.length) return null
  return makePrompt(state, {
    seat, type: 'smith', text: `Smith: promote a knight for free (${left} left)`,
    input: { kind: 'board', vertices }, optional: true, data: { left },
  })
}

export const ckActions = {
  buildKnight,
  improve,
  activateKnight,
  promoteKnight,
  moveKnight,
  chaseRobber,
  playProgress,
} satisfies Record<string, ActionHandler>

/* ------------------------------------------------------------------ *
 * Prompt answers
 * ------------------------------------------------------------------ */

type Respond = Extract<Action, { type: 'respond' }>

function cards(state: GameState, prompt: Prompt, response: Respond): CardCounts {
  if (prompt.input.kind !== 'cards') throw new RuleError('that prompt wants cards')
  const input = prompt.input
  const clean: CardCounts = {}
  for (const [k, v] of Object.entries(response.cards ?? {})) {
    if (!(CARDS as readonly string[]).includes(k) || !Number.isInteger(v) || (v as number) < 0) {
      throw new RuleError('malformed cards')
    }
    if ((v as number) > 0) clean[k as Card] = v as number
  }
  if (countOf(clean) !== input.count) throw new RuleError(`choose exactly ${input.count}`)
  if (input.allowed && Object.keys(clean).some((k) => !input.allowed!.includes(k as Card))) {
    throw new RuleError('those cards are not allowed here')
  }
  const source = input.source === 'hand' ? state.players[prompt.seat].hand
    : input.source === 'bank' ? state.bank : state.players[input.source.seat].hand
  for (const c of CARDS) if ((clean[c] ?? 0) > source[c]) throw new RuleError('those cards are not there')
  return clean
}

function choice(prompt: Prompt, response: Respond): string {
  if (prompt.input.kind !== 'choice' || !prompt.input.options.some((o) => o.id === response.choice)) {
    throw new RuleError('pick one of the options')
  }
  return response.choice!
}

function vertex(prompt: Prompt, response: Respond): number {
  if (prompt.input.kind !== 'board' || response.vertex === undefined || !prompt.input.vertices?.includes(response.vertex)) {
    throw new RuleError("that isn't one of the highlighted corners")
  }
  return response.vertex
}

function edge(prompt: Prompt, response: Respond): number {
  if (prompt.input.kind !== 'board' || response.edge === undefined || !prompt.input.edges?.includes(response.edge)) {
    throw new RuleError("that isn't one of the highlighted edges")
  }
  return response.edge
}

function hex(prompt: Prompt, response: Respond): number {
  if (prompt.input.kind !== 'board' || response.hex === undefined || !prompt.input.hexes?.includes(response.hex)) {
    throw new RuleError("that isn't one of the highlighted tiles")
  }
  return response.hex
}

export const ckPrompts: Partial<Record<Prompt['type'], PromptHandler>> = {
  cityLoss(state, prompt, response) {
    pillage(state, prompt.seat, vertex(prompt, response))
  },
  defenderPick(state, prompt, response) {
    drawProgress(state, prompt.seat, choice(prompt, response) as Track)
  },
  progressDiscard(state, prompt, response) {
    const i = Number(choice(prompt, response))
    const [card] = state.players[prompt.seat].progress.splice(i, 1)
    state.progressDecks[card.track].push(card.type)
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} discards a progress card`)
    if (progressOverLimit(state, prompt.seat)) pushFront(state, ...progressLimitPrompts(state, prompt.seat))
  },
  metropolis(state, prompt, response) {
    placeMetropolis(state, prompt.seat, prompt.data!.track as Track, vertex(prompt, response))
  },
  displaced(state, prompt, response) {
    const v = vertex(prompt, response)
    const knight = prompt.data!.knight as NonNullable<GameState['knights'][number]>
    if (state.knights[v] || state.buildings[v]) throw new RuleError('that corner is taken now')
    state.knights[v] = knight
    log(state, prompt.seat, `${nameOf(state, prompt.seat)}'s knight retreats`)
  },
  deserterSeat(state, prompt, response) {
    const victim = Number(choice(prompt, response))
    const vertices = state.knights.flatMap((k, v) => (k?.owner === victim ? [v] : []))
    pushFront(state, makePrompt(state, {
      seat: victim, type: 'deserterRemove', text: 'Deserter: choose one of your knights to remove',
      input: { kind: 'board', vertices }, data: { thief: prompt.seat },
    }))
  },
  deserterRemove(state, prompt, response) {
    const v = vertex(prompt, response)
    const k = state.knights[v]!
    state.knights[v] = null
    const thief = prompt.data!.thief as number
    log(state, prompt.seat, `${nameOf(state, prompt.seat)}'s knight deserts`)
    if (supplyLeft(state, thief).knight[k.level] <= 0) return
    const t = topo(state)
    const spots = t.vertices.flatMap((_, w) =>
      !state.buildings[w] && !state.knights[w] && vertexOnNetwork(state, t, thief, w) ? [w] : [],
    )
    if (!spots.length) return
    pushFront(state, makePrompt(state, {
      seat: thief, type: 'deserterPlace', text: `Deserter: place a ${['', 'basic', 'strong', 'mighty'][k.level]} knight`,
      input: { kind: 'board', vertices: spots }, optional: true, data: { level: k.level },
    }))
  },
  deserterPlace(state, prompt, response) {
    const v = vertex(prompt, response)
    state.knights[v] = { owner: prompt.seat, level: prompt.data!.level as 1 | 2 | 3, active: false }
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} welcomes the deserter`)
  },
  wedding(state, prompt, response) {
    const given = cards(state, prompt, response)
    const to = prompt.data!.to as number
    removeCards(state.players[prompt.seat].hand, given)
    addCards(state.players[to].hand, given)
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} gives ${countOf(given)} cards as a wedding gift`, {
      secret: { seats: [prompt.seat, to], text: describeCards(given) },
    })
  },
  masterMerchantSeat(state, prompt, response) {
    const victim = Number(choice(prompt, response))
    const count = Math.min(2, handSize(state.players[victim].hand))
    pushFront(state, makePrompt(state, {
      seat: prompt.seat, type: 'masterMerchantCards', text: `Master Merchant: take ${count} of ${nameOf(state, victim)}'s cards`,
      input: { kind: 'cards', count, source: { seat: victim } }, data: { victim },
    }))
  },
  masterMerchantCards(state, prompt, response) {
    const taken = cards(state, prompt, response)
    const victim = prompt.data!.victim as number
    removeCards(state.players[victim].hand, taken)
    addCards(state.players[prompt.seat].hand, taken)
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} takes ${countOf(taken)} cards from ${nameOf(state, victim)}`, {
      secret: { seats: [prompt.seat, victim], text: describeCards(taken) },
    })
  },
  spySeat(state, prompt, response) {
    const victim = Number(choice(prompt, response))
    pushFront(state, makePrompt(state, {
      seat: prompt.seat, type: 'spyCard', text: `Spy: take one of ${nameOf(state, victim)}'s progress cards`,
      input: {
        kind: 'choice',
        options: state.players[victim].progress.map((c, i) => ({ id: String(i), label: PROGRESS_INFO[c.type].title })),
      },
      data: { victim },
    }))
  },
  spyCard(state, prompt, response) {
    const victim = prompt.data!.victim as number
    const [card] = state.players[victim].progress.splice(Number(choice(prompt, response)), 1)
    state.players[prompt.seat].progress.push(card)
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} spies a progress card from ${nameOf(state, victim)}`, {
      secret: { seats: [prompt.seat, victim], text: PROGRESS_INFO[card.type].title },
    })
  },
  diplomatRemove(state, prompt, response) {
    const e = edge(prompt, response)
    const owner = state.routes[e]!.owner
    state.routes[e] = null
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} removes ${owner === prompt.seat ? 'their own' : `${nameOf(state, owner)}'s`} road`)
    if (owner !== prompt.seat) return
    const edges = legalRoutes(state, owner, 'road').filter((x) => x !== e)
    if (!edges.length) return
    pushFront(state, makePrompt(state, {
      seat: owner, type: 'diplomatReplace', text: 'Diplomat: rebuild your road for free',
      input: { kind: 'board', edges, pieces: ['road'] }, optional: true,
    }))
  },
  diplomatReplace(state, prompt, response) {
    const e = edge(prompt, response)
    if (!canPlaceRoute(state, prompt.seat, e, 'road')) throw new RuleError("a road can't go there")
    state.routes[e] = { owner: prompt.seat, kind: 'road', built: state.turn.number }
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} rebuilds the road`)
  },
  inventor(state, prompt, response) {
    const picks = response.hexes ?? []
    if (picks.length !== 2 || picks[0] === picks[1] || prompt.input.kind !== 'board' ||
        !picks.every((h) => (prompt.input as { hexes?: number[] }).hexes?.includes(h))) {
      throw new RuleError('choose two of the highlighted tiles')
    }
    const [x, y] = picks.map((h) => state.map.hexes[h])
    ;[x.number, y.number] = [y.number, x.number]
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} swaps a ${y.number} and a ${x.number}`)
  },
  merchantPlace(state, prompt, response) {
    const h = hex(prompt, response)
    state.merchant = { hex: h, owner: prompt.seat }
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} places the merchant on ${cardName(state.map.hexes[h].terrain as Card)}`)
  },
  merchantFleet(state, prompt, response) {
    state.turn.fleet = choice(prompt, response) as Card
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} trades ${cardName(state.turn.fleet)} 2:1 this turn`)
  },
  resourceMonopoly(state, prompt, response) {
    const c = choice(prompt, response) as Card
    let total = 0
    for (const o of opponents(state, prompt.seat)) {
      const n = Math.min(2, state.players[o].hand[c])
      state.players[o].hand[c] -= n
      state.players[prompt.seat].hand[c] += n
      total += n
    }
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} collects ${total} ${cardName(c)}`)
  },
  tradeMonopoly(state, prompt, response) {
    const c = choice(prompt, response) as Card
    let total = 0
    for (const o of opponents(state, prompt.seat)) {
      const n = Math.min(1, state.players[o].hand[c])
      state.players[o].hand[c] -= n
      state.players[prompt.seat].hand[c] += n
      total += n
    }
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} collects ${total} ${cardName(c)}`)
  },
  medicine(state, prompt, response) {
    const v = vertex(prompt, response)
    pay(state, prompt.seat, COSTS.medicineCity)
    state.buildings[v] = { ...state.buildings[v]!, kind: 'city' }
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} builds a city with Medicine`)
  },
  engineer(state, prompt, response) {
    const v = vertex(prompt, response)
    state.buildings[v]!.wall = true
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} builds a free city wall`)
  },
  smith(state, prompt, response) {
    const v = vertex(prompt, response)
    const problem = canPromote(state, prompt.seat, v)
    if (problem) throw new RuleError(problem)
    promote(state, prompt.seat, v)
    const left = (prompt.data!.left as number) - 1
    if (left > 0) {
      const next = smithPrompt(state, prompt.seat, left)
      if (next) pushFront(state, next)
    }
  },
  intrigue(state, prompt, response) {
    const v = vertex(prompt, response)
    const victim = state.knights[v]!
    state.knights[v] = null
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} displaces ${nameOf(state, victim.owner)}'s knight`)
    displace(state, v, victim)
  },
  commercialHarborGive(state, prompt, response) {
    const given = cards(state, prompt, response)
    const victim = prompt.data!.victim as number
    removeCards(state.players[prompt.seat].hand, given)
    addCards(state.players[victim].hand, given)
    const count = COMMODITIES.reduce((s, c) => s + state.players[victim].hand[c], 0)
    if (count === 0) return
    pushFront(state, makePrompt(state, {
      seat: victim, type: 'commercialHarborReturn', text: `Commercial Harbor: give ${nameOf(state, prompt.seat)} a commodity`,
      input: { kind: 'cards', count: 1, source: 'hand', allowed: [...COMMODITIES] }, data: { to: prompt.seat, got: given },
    }))
  },
  commercialHarborReturn(state, prompt, response) {
    const given = cards(state, prompt, response)
    const to = prompt.data!.to as number
    removeCards(state.players[prompt.seat].hand, given)
    addCards(state.players[to].hand, given)
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} and ${nameOf(state, to)} trade through the Commercial Harbor`, {
      secret: { seats: [prompt.seat, to], text: `${describeCards(prompt.data!.got as CardCounts)} for ${describeCards(given)}` },
    })
  },
}

