/**
 * The referee: `createGame` builds a starting state, and `applyAction` takes
 * a state, a seat and an action and returns the next state — or throws a
 * RuleError saying why not. Nothing here touches the network, the DOM or the
 * clock except through `ctx`, so the browser, the Cloud Function and the
 * tests all run exactly the same rules.
 */
import { COMMODITY_BANK, bankSizeFor, devDeckFor } from './config'
import { ckActions, ckPrompts, ckTasks, progressDeck, progressOverLimit, progressLimitPrompts } from './ck'
import { fishActions, fishPrompts, fishDeck } from './fish'
import { autopilot } from './bot'
import { largeMap, scenarioMap, standardMap, type GeneratedMap } from './maps'
import {
  canPlaceCity,
  canPlaceRoute,
  canPlaceSettlement,
  legalRoutes,
  routeAnswer,
  shipCanMove,
} from './placement'
import {
  actingSeat,
  checkVictory,
  discardPrompts,
  islandBonus,
  moveRobber,
  produce,
  revealAllVeils,
  revealCorner,
  revealFog,
  robberPrompt,
  rollDice,
  spreadDesert,
  startNextTurn,
  steal,
  task,
  updateAwards,
  waitingOn,
  type Ctx,
  type RobberCause,
} from './rules'
import { shuffle } from './rng'
import {
  COSTS,
  DEV_NAMES,
  activePrompts,
  addCards,
  cardName,
  cleanCards,
  countOf,
  describeCards,
  emptyHand,
  handSize,
  hasCards,
  isResource,
  knownLand,
  log,
  makePrompt,
  nameOf,
  nextSeat,
  othersInOrder,
  pay,
  pieceCounts,
  pushFront,
  removeCards,
  supplyLeft,
  takeFromBank,
  topo,
  tradeRatios,
} from './state'
import {
  CARDS,
  RESOURCES,
  RuleError,
  type Action,
  type BuildingKind,
  type Card,
  type CardCounts,
  type DevCardType,
  type GameConfig,
  type GameState,
  type PlayerColor,
  type PlayerState,
  type Prompt,
  type Resource,
  type RouteKind,
  type SetupStep,
} from './types'

export type { Ctx } from './rules'

type Respond = Extract<Action, { type: 'respond' }>
export type PromptHandler = (state: GameState, prompt: Prompt, response: Respond, ctx: Ctx) => void
export type TaskHandler = (state: GameState, data: Record<string, unknown>, ctx: Ctx) => void
export type ActionHandler = (state: GameState, seat: number, action: Action, ctx: Ctx) => void

/* ------------------------------------------------------------------ *
 * Creating a game
 * ------------------------------------------------------------------ */

export interface SeatInfo {
  name: string
  color: PlayerColor
  bot: boolean
}

/** A game already in progress — from the Position page, or the board generator's opening. */
export interface StartPosition {
  buildings?: Array<{ vertex: number; owner: number; kind: BuildingKind }>
  routes?: Array<{ edge: number; owner: number; kind: RouteKind }>
  robber?: number
  knightsPlayed?: number[]
  victoryCards?: number[]
  /**
   * Opening settlements already down, in snake order, with no roads yet: the
   * setup phase still runs, and each seat places the road beside theirs.
   */
  opening?: number[]
  hands?: CardCounts[]
  /** Who holds an award when a snapshot can't tell (a tie). */
  claims?: { longestRoad?: number; largestArmy?: number }
}

export interface NewGame {
  config: GameConfig
  seats: SeatInfo[]
  /** A fixed map (an imported board). Otherwise one is generated from the config. */
  map?: GeneratedMap
  start?: StartPosition
}

export function generateMapFor(config: GameConfig, ctx: Ctx): GeneratedMap {
  const opts = { fishermen: config.fishermen }
  if (config.scenario) return scenarioMap(config.scenario, config.players, ctx.rng, opts)
  if (config.players > 4) return largeMap(config.players, ctx.rng, opts)
  return standardMap(ctx.rng, opts)
}

const DEV_TYPES: DevCardType[] = ['knight', 'victory', 'roadBuilding', 'yearOfPlenty', 'monopoly']

function newPlayer(seat: { name: string; color: PlayerColor; bot: boolean }): PlayerState {
  return {
    name: seat.name,
    color: seat.color,
    bot: seat.bot,
    hand: emptyHand(),
    dev: [],
    knightsPlayed: 0,
    progress: [],
    progressPoints: 0,
    defenderPoints: 0,
    improvements: { trade: 0, politics: 0, science: 0 },
    fish: [],
    hasBoot: false,
    islandPoints: 0,
    rewardedRegions: [],
    homeRegions: [],
    sevens: 0,
  }
}

export function setupSteps(players: number, citiesKnights: boolean): SetupStep[] {
  const steps: SetupStep[] = []
  for (let s = 0; s < players; s++) steps.push({ seat: s, building: 'settlement', gains: false })
  for (let s = players - 1; s >= 0; s--) {
    steps.push({ seat: s, building: citiesKnights ? 'city' : 'settlement', gains: true })
  }
  return steps
}

export function createGame(setup: NewGame, ctx: Ctx): GameState {
  const players = setup.seats.length
  if (players < 2 || players > 8) throw new RuleError('a game needs 2 to 8 players')
  const config: GameConfig = { ...setup.config, players }
  const generated = setup.map ? structuredClone(setup.map) : generateMapFor(config, ctx)
  const map = generated.map
  if (config.veil !== 'none') {
    for (const h of map.hexes) {
      if (knownLand(h) && !h.veil) h.veil = config.veil === 'blind' ? 'blind' : 'terrain'
    }
  }
  const t = topo({ map } as GameState)
  const devCounts = devDeckFor(players)
  const bankSize = bankSizeFor(players)
  const bank = emptyHand()
  for (const r of RESOURCES) bank[r] = bankSize
  if (config.citiesKnights) for (const c of ['paper', 'cloth', 'coin'] as const) bank[c] = COMMODITY_BANK

  const state: GameState = {
    schema: 1,
    config,
    map,
    players: setup.seats.map(newPlayer),
    buildings: t.vertices.map(() => null),
    routes: t.edges.map(() => null),
    knights: t.vertices.map(() => null),
    robber: generated.robber,
    pirate: config.seafarers ? generated.pirate : -1,
    merchant: null,
    phase: 'setup',
    setup: null,
    turn: {
      seat: 0,
      number: 0,
      rolled: false,
      dice: null,
      devPlayed: false,
      shipMoved: false,
      stage: { kind: 'main' },
      fleet: null,
      crane: false,
      alchemist: null,
    },
    queue: [],
    offers: [],
    bank,
    devDeck: config.citiesKnights
      ? []
      : shuffle(ctx.rng, DEV_TYPES.flatMap((d) => Array<DevCardType>(devCounts[d]).fill(d))),
    progressDecks: config.citiesKnights
      ? progressDeck(ctx.rng)
      : { trade: [], politics: [], science: [] },
    fishDeck: config.fishermen ? fishDeck() : [],
    fishDiscard: [],
    diceDeck: [],
    barbarian: config.citiesKnights ? { position: 0, attacks: 0 } : null,
    metropolis: { trade: null, politics: null, science: null },
    longestRoad: null,
    largestArmy: null,
    winner: null,
    log: [],
    seq: 0,
    ids: 0,
    rolls: Array(13).fill(0),
    deadline: null,
  }

  const start = setup.start ?? {}
  for (const b of start.buildings ?? []) {
    if (b.vertex < 0 || b.vertex >= state.buildings.length || b.owner < 0 || b.owner >= players) continue
    if (b.kind !== 'settlement' && b.kind !== 'city') continue
    state.buildings[b.vertex] = { owner: b.owner, kind: b.kind }
    revealCorner(state, b.vertex)
  }
  for (const r of start.routes ?? []) {
    if (r.edge < 0 || r.edge >= state.routes.length || r.owner < 0 || r.owner >= players) continue
    if (r.kind !== 'road' && !(r.kind === 'ship' && config.seafarers)) continue
    state.routes[r.edge] = { owner: r.owner, kind: r.kind, built: 0 }
  }
  if (start.robber !== undefined && start.robber >= 0 && start.robber < map.hexes.length) state.robber = start.robber
  start.hands?.forEach((cards, i) => {
    if (state.players[i]) takeFromBank(state, i, cleanCards(cards))
  })
  start.knightsPlayed?.forEach((n, i) => {
    if (!state.players[i] || config.citiesKnights) return
    for (let k = 0; k < n; k++) {
      const at = state.devDeck.indexOf('knight')
      if (at < 0) break
      state.devDeck.splice(at, 1)
      state.players[i].knightsPlayed++
    }
  })
  start.victoryCards?.forEach((n, i) => {
    if (!state.players[i] || config.citiesKnights) return
    for (let k = 0; k < n; k++) {
      const at = state.devDeck.indexOf('victory')
      if (at < 0) break
      state.devDeck.splice(at, 1)
      state.players[i].dev.push({ type: 'victory', bought: 0 })
    }
  })
  if (start.claims?.longestRoad !== undefined) state.longestRoad = { owner: start.claims.longestRoad, size: 0 }
  if (start.claims?.largestArmy !== undefined) state.largestArmy = { owner: start.claims.largestArmy, size: 0 }

  // Anyone with buildings already down calls the regions they sit in home.
  state.buildings.forEach((b, v) => {
    if (!b) return
    for (const h of t.vertices[v].hexes) {
      const region = map.hexes[h].region
      const p = state.players[b.owner]
      if (region >= 0 && !p.homeRegions.includes(region)) p.homeRegions.push(region)
    }
  })

  const hasPosition = (start.buildings?.length ?? 0) > 0 && !start.opening?.length
  if (hasPosition) {
    beginMainPhase(state)
  } else {
    const steps = setupSteps(players, config.citiesKnights)
    ;(start.opening ?? []).slice(0, steps.length).forEach((vertex, i) => {
      if (!canPlaceSettlement(state, steps[i].seat, vertex, true)) return
      steps[i].preset = vertex
      placeSetupBuilding(state, steps[i], vertex)
    })
    state.setup = { steps, index: 0, anchor: steps[0].preset ?? null }
    log(state, null, 'The game begins: place your opening settlements')
  }
  updateAwards(state)
  runQueue(state, ctx)
  if (config.turnTimer > 0) state.deadline = ctx.now + config.turnTimer * 1000
  return state
}

function beginMainPhase(state: GameState) {
  state.phase = 'main'
  state.setup = null
  revealAllVeils(state)
  state.turn = { ...state.turn, seat: 0, number: 1, rolled: false, dice: null, stage: { kind: 'main' } }
  log(state, 0, `${nameOf(state, 0)} starts`)
}

/* ------------------------------------------------------------------ *
 * Setup phase
 * ------------------------------------------------------------------ */

function placeSetupBuilding(state: GameState, step: SetupStep, vertex: number) {
  const t = topo(state)
  state.buildings[vertex] = { owner: step.seat, kind: step.building }
  revealCorner(state, vertex)
  const player = state.players[step.seat]
  for (const h of t.vertices[vertex].hexes) {
    const region = state.map.hexes[h].region
    if (region >= 0 && !player.homeRegions.includes(region)) player.homeRegions.push(region)
  }
  if (!step.gains) return
  const gains: CardCounts = {}
  let gold = 0
  for (const h of t.vertices[vertex].hexes) {
    const hex = state.map.hexes[h]
    if (hex.veil === 'fog') continue
    if (isResource(hex.terrain)) gains[hex.terrain] = (gains[hex.terrain] ?? 0) + 1
    if (hex.terrain === 'gold') gold++
  }
  const given: CardCounts = {}
  for (const r of RESOURCES) {
    const n = Math.min(gains[r] ?? 0, state.bank[r])
    if (n > 0) {
      given[r] = n
      state.bank[r] -= n
      player.hand[r] += n
    }
  }
  if (countOf(given) > 0) log(state, step.seat, `${player.name} takes ${describeCards(given)}`)
  if (gold > 0) {
    pushFront(state, makePrompt(state, {
      seat: step.seat,
      type: 'gold',
      text: `Gold field: choose ${gold} resource${gold > 1 ? 's' : ''}`,
      input: { kind: 'cards', count: gold, source: 'bank', allowed: [...RESOURCES] },
    }))
  }
}

function setupBuild(state: GameState, seat: number, action: Extract<Action, { type: 'build' }>) {
  const setup = state.setup!
  const step = setup.steps[setup.index]
  if (step.seat !== seat) throw new RuleError("it isn't your placement")
  if (setup.anchor === null) {
    if (action.piece !== step.building && !(action.piece === 'settlement' && step.building === 'city')) {
      throw new RuleError(`place a ${step.building} first`)
    }
    if (!canPlaceSettlement(state, seat, action.at, true)) throw new RuleError("you can't build there")
    placeSetupBuilding(state, step, action.at)
    setup.anchor = action.at
    log(state, seat, `${nameOf(state, seat)} places a ${step.building}`)
    return
  }
  if (action.piece !== 'road' && action.piece !== 'ship') throw new RuleError('now place a road beside it')
  if (action.piece === 'ship' && !state.config.seafarers) throw new RuleError('ships need Seafarers')
  if (!canPlaceRoute(state, seat, action.at, action.piece, { anchor: setup.anchor })) {
    const edge = topo(state).edges[action.at]
    const touches = edge && (edge.a === setup.anchor || edge.b === setup.anchor)
    throw new RuleError(touches ? `a ${action.piece} can't go there` : `the ${action.piece} must touch the ${step.building} you just placed`)
  }
  state.routes[action.at] = { owner: seat, kind: action.piece, built: 0 }
  revealFog(state, seat, action.at)
  log(state, seat, `${nameOf(state, seat)} places a ${action.piece}`)
  setup.index++
  setup.anchor = null
  if (setup.index >= setup.steps.length) {
    beginMainPhase(state)
    return
  }
  const next = setup.steps[setup.index]
  if (next.preset !== undefined) setup.anchor = next.preset
}

/* ------------------------------------------------------------------ *
 * Queue
 * ------------------------------------------------------------------ */

const TASKS: Record<string, TaskHandler> = {
  seven(state) {
    const steps = [...discardPrompts(state), task('sevenRobber')]
    if (state.config.dustBowl) steps.push(task('dustBowl'))
    pushFront(state, ...steps)
  },
  sevenRobber(state) {
    // In Cities & Knights the robber waits until the barbarians first land.
    if (state.config.citiesKnights && (state.barbarian?.attacks ?? 0) === 0) {
      log(state, null, 'The robber stays put until the barbarians first attack')
      return
    }
    pushFront(state, robberPrompt(state, state.turn.seat, 'seven'))
  },
  produce(state, data, ctx) {
    produce(state, data.total as number, ctx)
  },
  dustBowl(state) {
    spreadDesert(state)
  },
  finishEndTurn(state) {
    finishEndTurn(state)
  },
  freeRoads(state, data) {
    const left = data.left as number
    const seat = data.seat as number
    const prompt = freeRoadPrompt(state, seat, left, (data.reason as string) ?? 'Road Building')
    if (prompt) pushFront(state, prompt)
  },
  ...ckTasks,
}

/** Run tasks until a prompt reaches the front, or the queue empties. */
export function runQueue(state: GameState, ctx: Ctx) {
  for (let guard = 0; guard < 500; guard++) {
    const step = state.queue[0]
    if (!step || step.kind === 'prompt') return
    state.queue.shift()
    const handler = TASKS[step.task]
    if (!handler) throw new Error(`unknown task "${step.task}"`)
    handler(state, step.data ?? {}, ctx)
    if (state.phase === 'ended') return
  }
  throw new Error('the game queue did not settle')
}

/* ------------------------------------------------------------------ *
 * Prompt helpers
 * ------------------------------------------------------------------ */

export function freeRoadPrompt(state: GameState, seat: number, left: number, reason: string): Prompt | null {
  const roads = legalRoutes(state, seat, 'road')
  const ships = state.config.seafarers ? legalRoutes(state, seat, 'ship') : []
  const edges = [...new Set([...roads, ...ships])]
  if (edges.length === 0) return null
  return makePrompt(state, {
    seat,
    type: 'freeRoad',
    text: `${reason}: place a free ${state.config.seafarers ? 'road or ship' : 'road'} (${left} left)`,
    input: { kind: 'board', edges, pieces: state.config.seafarers ? ['road', 'ship'] : ['road'] },
    optional: true,
    data: { left, reason },
  })
}

/** How many cards a card prompt can actually be answered with right now. */
export function promptCardCount(state: GameState, prompt: Prompt): number {
  if (prompt.input.kind !== 'cards') return 0
  const input = prompt.input
  const source =
    input.source === 'hand' ? state.players[prompt.seat].hand
    : input.source === 'bank' ? state.bank
    : state.players[input.source.seat].hand
  const kinds = input.allowed ?? CARDS
  return Math.min(input.count, kinds.reduce((s, c) => s + source[c], 0))
}

/** Check a card answer against what the prompt asked for. */
export function cardsAnswer(state: GameState, prompt: Prompt, cards: CardCounts | undefined): CardCounts {
  if (prompt.input.kind !== 'cards') throw new RuleError('that prompt wants something else')
  const input = prompt.input
  const clean = cleanCards(cards)
  const source =
    input.source === 'hand' ? state.players[prompt.seat].hand
    : input.source === 'bank' ? state.bank
    : state.players[input.source.seat].hand
  // Never ask for more than the source holds, so a prompt can always be answered.
  const count = promptCardCount(state, prompt)
  if (countOf(clean) !== count) throw new RuleError(`choose exactly ${count} card${count === 1 ? '' : 's'}`)
  if (input.allowed && Object.keys(clean).some((k) => !input.allowed!.includes(k as Card))) {
    throw new RuleError('those cards are not allowed here')
  }
  if (!hasCards(source, clean)) throw new RuleError(input.source === 'bank' ? "the bank doesn't have those" : 'those cards are not there')
  return clean
}

export function choiceAnswer(prompt: Prompt, choice: string | undefined): string {
  if (prompt.input.kind !== 'choice') throw new RuleError('that prompt wants something else')
  if (choice === undefined || !prompt.input.options.some((o) => o.id === choice)) throw new RuleError('pick one of the options')
  return choice
}

export function boardAnswer(prompt: Prompt, key: 'vertices' | 'edges' | 'hexes', value: number | undefined): number {
  if (prompt.input.kind !== 'board') throw new RuleError('that prompt wants something else')
  const list = prompt.input[key]
  if (value === undefined || !list?.includes(value)) throw new RuleError("that isn't one of the highlighted spots")
  return value
}

const BASE_PROMPTS: Partial<Record<Prompt['type'], PromptHandler>> = {
  discard(state, prompt, response) {
    const cards = cardsAnswer(state, prompt, response.cards)
    pay(state, prompt.seat, cards)
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} discards ${countOf(cards)} cards`, {
      secret: { seats: [prompt.seat], text: describeCards(cards) },
    })
  },
  robber(state, prompt, response, ctx) {
    const hex = boardAnswer(prompt, 'hexes', response.hex)
    moveRobber(state, prompt.seat, hex, (prompt.data?.cause as RobberCause) ?? 'seven', ctx)
  },
  steal(state, prompt, response, ctx) {
    const victim = Number(choiceAnswer(prompt, response.choice))
    steal(state, prompt.seat, victim, ctx)
  },
  gold(state, prompt, response) {
    const cards = cardsAnswer(state, prompt, response.cards)
    removeCards(state.bank, cards)
    addCards(state.players[prompt.seat].hand, cards)
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} takes ${describeCards(cards)} from the gold field`)
  },
  aqueduct(state, prompt, response) {
    const cards = cardsAnswer(state, prompt, response.cards)
    removeCards(state.bank, cards)
    addCards(state.players[prompt.seat].hand, cards)
    log(state, prompt.seat, `${nameOf(state, prompt.seat)}'s aqueduct brings ${describeCards(cards)}`)
  },
  freeRoad(state, prompt, response) {
    const edge = boardAnswer(prompt, 'edges', response.edge)
    const seat = prompt.seat
    const kind = routeAnswer(state, prompt, edge, response.piece)
    state.routes[edge] = { owner: seat, kind, built: state.turn.number }
    revealFog(state, seat, edge)
    log(state, seat, `${nameOf(state, seat)} builds a free ${kind}`)
    const left = (prompt.data?.left as number) - 1
    if (left > 0) {
      const next = freeRoadPrompt(state, seat, left, (prompt.data?.reason as string) ?? 'Road Building')
      if (next) pushFront(state, next)
    }
  },
  yearOfPlenty(state, prompt, response) {
    const cards = cardsAnswer(state, prompt, response.cards)
    removeCards(state.bank, cards)
    addCards(state.players[prompt.seat].hand, cards)
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} takes ${describeCards(cards)} (Year of Plenty)`)
  },
  monopoly(state, prompt, response) {
    const resource = choiceAnswer(prompt, response.choice) as Resource
    let total = 0
    state.players.forEach((p, i) => {
      if (i === prompt.seat) return
      total += p.hand[resource]
      state.players[prompt.seat].hand[resource] += p.hand[resource]
      p.hand[resource] = 0
    })
    log(state, prompt.seat, `${nameOf(state, prompt.seat)} monopolises ${cardName(resource)} and takes ${total}`)
  },
}

const PROMPTS: Partial<Record<Prompt['type'], PromptHandler>> = { ...BASE_PROMPTS, ...ckPrompts, ...fishPrompts }

function respond(state: GameState, seat: number, action: Respond, ctx: Ctx) {
  const active = activePrompts(state)
  const prompt = active.find((p) => p.id === action.prompt)
  if (!prompt) throw new RuleError('that question has already been answered')
  if (prompt.seat !== seat) throw new RuleError("that question isn't yours to answer")
  state.queue.splice(state.queue.indexOf(prompt), 1)
  if (action.skip) {
    if (!prompt.optional) throw new RuleError('you have to answer this one')
    log(state, seat, `${nameOf(state, seat)} passes`)
    return
  }
  const handler = PROMPTS[prompt.type]
  if (!handler) throw new Error(`no handler for prompt "${prompt.type}"`)
  handler(state, prompt, action, ctx)
}

/* ------------------------------------------------------------------ *
 * Main-phase actions
 * ------------------------------------------------------------------ */

function requireActor(state: GameState, seat: number) {
  if (state.phase === 'ended') throw new RuleError('the game is over')
  if (state.phase !== 'main') throw new RuleError('place your opening pieces first')
  if (activePrompts(state).length > 0) throw new RuleError('waiting for everyone to answer first')
  if (actingSeat(state) !== seat) throw new RuleError("it isn't your turn")
}

function requireRolled(state: GameState) {
  if (state.turn.stage.kind === 'main' && !state.turn.rolled) throw new RuleError('roll the dice first')
}

const stage = (state: GameState) => state.turn.stage.kind

function build(state: GameState, seat: number, action: Extract<Action, { type: 'build' }>, ctx: Ctx) {
  if (state.phase === 'setup') {
    if (activePrompts(state).length) throw new RuleError('waiting for everyone to answer first')
    setupBuild(state, seat, action)
    return
  }
  requireActor(state, seat)
  requireRolled(state)
  const at = action.at
  switch (action.piece) {
    case 'road':
    case 'ship': {
      if (action.piece === 'ship' && !state.config.seafarers) throw new RuleError('ships need Seafarers')
      if (!canPlaceRoute(state, seat, at, action.piece)) throw new RuleError(`you can't build a ${action.piece} there`)
      pay(state, seat, COSTS[action.piece])
      state.routes[at] = { owner: seat, kind: action.piece, built: state.turn.number }
      revealFog(state, seat, at)
      log(state, seat, `${nameOf(state, seat)} builds a ${action.piece}`)
      return
    }
    case 'settlement': {
      if (!canPlaceSettlement(state, seat, at, false)) throw new RuleError("you can't build a settlement there")
      pay(state, seat, COSTS.settlement)
      state.buildings[at] = { owner: seat, kind: 'settlement' }
      revealCorner(state, at)
      log(state, seat, `${nameOf(state, seat)} builds a settlement`)
      islandBonus(state, seat, at)
      return
    }
    case 'city': {
      if (!canPlaceCity(state, seat, at)) throw new RuleError('you need one of your settlements there')
      pay(state, seat, COSTS.city)
      state.buildings[at] = { ...state.buildings[at]!, kind: 'city' }
      log(state, seat, `${nameOf(state, seat)} builds a city`)
      return
    }
    case 'wall': {
      if (!state.config.citiesKnights) throw new RuleError('walls need Cities & Knights')
      const b = state.buildings[at]
      if (!b || b.owner !== seat || b.kind !== 'city' || b.wall) throw new RuleError('walls go under your own cities')
      if (supplyLeft(state, seat).wall <= 0) throw new RuleError('you have no walls left')
      pay(state, seat, COSTS.wall)
      b.wall = true
      log(state, seat, `${nameOf(state, seat)} builds a city wall`)
      return
    }
    case 'knight': {
      ckActions.buildKnight(state, seat, action, ctx)
      return
    }
    default:
      throw new RuleError('unknown piece')
  }
}

function moveShip(state: GameState, seat: number, action: Extract<Action, { type: 'moveShip' }>) {
  requireActor(state, seat)
  requireRolled(state)
  if (!state.config.seafarers) throw new RuleError('ships need Seafarers')
  if (stage(state) === 'specialBuild') throw new RuleError('ships stay put during the special build phase')
  if (state.turn.shipMoved) throw new RuleError('you have already moved a ship this turn')
  if (!shipCanMove(state, seat, action.from)) throw new RuleError('only a ship at the open end of a line, not built this turn, can sail')
  if (action.from === action.to) throw new RuleError('pick somewhere else for the ship')
  const ship = state.routes[action.from]!
  state.routes[action.from] = null
  if (!canPlaceRoute(state, seat, action.to, 'ship')) {
    state.routes[action.from] = ship
    throw new RuleError("the ship can't sail there")
  }
  state.routes[action.to] = ship
  state.turn.shipMoved = true
  revealFog(state, seat, action.to)
  log(state, seat, `${nameOf(state, seat)} moves a ship`)
}

function buyDev(state: GameState, seat: number) {
  requireActor(state, seat)
  requireRolled(state)
  if (state.config.citiesKnights) throw new RuleError('Cities & Knights has progress cards instead')
  if (state.devDeck.length === 0) throw new RuleError('the development deck is empty')
  pay(state, seat, COSTS.dev)
  const card = state.devDeck.pop()!
  state.players[seat].dev.push({ type: card, bought: state.turn.number })
  log(state, seat, `${nameOf(state, seat)} buys a development card`, {
    secret: { seats: [seat], text: DEV_NAMES[card] },
  })
}

export { DEV_NAMES }

function playDev(state: GameState, seat: number, action: Extract<Action, { type: 'playDev' }>) {
  requireActor(state, seat)
  if (state.config.citiesKnights) throw new RuleError('Cities & Knights has progress cards instead')
  if (stage(state) === 'specialBuild') throw new RuleError('no development cards in the special build phase')
  if (state.turn.devPlayed) throw new RuleError('one development card per turn')
  const player = state.players[seat]
  const index = player.dev.findIndex((d) => d.type === action.card && d.bought < state.turn.number)
  if (index < 0) {
    throw new RuleError(player.dev.some((d) => d.type === action.card) ? "you can't play a card the turn you buy it" : "you don't have that card")
  }
  player.dev.splice(index, 1)
  state.turn.devPlayed = true
  switch (action.card) {
    case 'knight':
      player.knightsPlayed++
      log(state, seat, `${player.name} plays a Knight`)
      updateAwards(state)
      pushFront(state, robberPrompt(state, seat, 'knight'))
      break
    case 'roadBuilding': {
      log(state, seat, `${player.name} plays Road Building`)
      const prompt = freeRoadPrompt(state, seat, 2, 'Road Building')
      if (prompt) pushFront(state, prompt)
      break
    }
    case 'yearOfPlenty': {
      log(state, seat, `${player.name} plays Year of Plenty`)
      const count = Math.min(2, RESOURCES.reduce((s, r) => s + state.bank[r], 0))
      if (count > 0) {
        pushFront(state, makePrompt(state, {
          seat,
          type: 'yearOfPlenty',
          text: `Year of Plenty: take ${count} resource${count > 1 ? 's' : ''} from the bank`,
          input: { kind: 'cards', count, source: 'bank', allowed: [...RESOURCES] },
        }))
      }
      break
    }
    case 'monopoly':
      log(state, seat, `${player.name} plays Monopoly`)
      pushFront(state, makePrompt(state, {
        seat,
        type: 'monopoly',
        text: 'Monopoly: name a resource',
        input: { kind: 'choice', options: RESOURCES.map((r) => ({ id: r, label: cardName(r) })) },
      }))
      break
    default:
      throw new RuleError('unknown card')
  }
}

function tradeBank(state: GameState, seat: number, action: Extract<Action, { type: 'tradeBank' }>) {
  requireActor(state, seat)
  requireRolled(state)
  if (stage(state) === 'specialBuild') throw new RuleError('no trading in the special build phase')
  const give = cleanCards(action.give)
  const get = cleanCards(action.get)
  if (countOf(give) === 0 || countOf(get) === 0) throw new RuleError('choose what to give and what to take')
  const ratios = tradeRatios(state, seat)
  let credit = 0
  for (const c of CARDS) {
    const n = give[c] ?? 0
    if (n === 0) continue
    if (get[c]) throw new RuleError("you can't trade a card for itself")
    if (n % ratios[c] !== 0) throw new RuleError(`${cardName(c)} trades ${ratios[c]}:1 for you`)
    credit += n / ratios[c]
  }
  if (credit !== countOf(get)) throw new RuleError(`that pays for ${credit} card${credit === 1 ? '' : 's'}, not ${countOf(get)}`)
  if (!hasCards(state.players[seat].hand, give)) throw new RuleError("you don't have those cards")
  if (!hasCards(state.bank, get)) throw new RuleError("the bank doesn't have those")
  pay(state, seat, give)
  removeCards(state.bank, get)
  addCards(state.players[seat].hand, get)
  state.turn.bankTrades = (state.turn.bankTrades ?? 0) + 1
  log(state, seat, `${nameOf(state, seat)} trades ${describeCards(give)} for ${describeCards(get)} with the bank`)
}

/* ---- player trades ---- */

function tradingOpen(state: GameState) {
  if (!state.config.playerTrades) throw new RuleError('player trades are off in this game')
  if (state.phase !== 'main') throw new RuleError('trading opens after setup')
  if (activePrompts(state).length > 0) throw new RuleError('waiting for everyone to answer first')
  if (stage(state) !== 'main') throw new RuleError('only the player whose turn it is can trade with others')
  if (!state.turn.rolled) throw new RuleError('trading opens once the dice are rolled')
}

function offer(state: GameState, seat: number, action: Extract<Action, { type: 'offer' }>) {
  tradingOpen(state)
  const give = cleanCards(action.give)
  const get = cleanCards(action.get)
  // No gifts: both sides must hand something over, and not the same kind.
  if (countOf(give) === 0 || countOf(get) === 0) throw new RuleError('a trade needs cards going both ways')
  if (CARDS.some((c) => give[c] && get[c])) throw new RuleError("you can't trade a card for the same card")
  if (!hasCards(state.players[seat].hand, give)) throw new RuleError("you don't have those cards")
  const current = state.turn.seat
  let to = (action.to ?? []).filter((s) => s !== seat && state.players[s] && !state.players[s].resigned)
  if (seat === current) {
    if (to.length === 0) to = othersInOrder(state, seat)
  } else {
    // Anyone may offer to the player whose turn it is, and only to them.
    to = [current]
  }
  if (state.offers.filter((o) => o.from === seat).length >= 5) throw new RuleError('too many open offers')
  state.ids++
  state.offers.push({ id: `o${state.ids}`, from: seat, to, give, get, accepted: [], rejected: [] })
  log(state, seat, `${nameOf(state, seat)} offers ${describeCards(give)} for ${describeCards(get)}`)
}

function offerRespond(state: GameState, seat: number, action: Extract<Action, { type: 'offerRespond' }>) {
  const o = state.offers.find((x) => x.id === action.id)
  if (!o) throw new RuleError('that offer is gone')
  if (!o.to.includes(seat)) throw new RuleError("that offer isn't open to you")
  o.accepted = o.accepted.filter((s) => s !== seat)
  o.rejected = o.rejected.filter((s) => s !== seat)
  if (action.accept) {
    if (!hasCards(state.players[seat].hand, o.get)) throw new RuleError("you don't have what they're asking for")
    o.accepted.push(seat)
  } else {
    o.rejected.push(seat)
  }
}

function offerConfirm(state: GameState, seat: number, action: Extract<Action, { type: 'offerConfirm' }>) {
  tradingOpen(state)
  const o = state.offers.find((x) => x.id === action.id)
  if (!o) throw new RuleError('that offer is gone')
  if (o.from !== seat) throw new RuleError('only whoever made the offer can close it')
  if (!o.accepted.includes(action.with)) throw new RuleError("they haven't accepted")
  if (seat !== state.turn.seat && action.with !== state.turn.seat) throw new RuleError('trades must include the player whose turn it is')
  const mine = state.players[seat].hand
  const theirs = state.players[action.with].hand
  if (!hasCards(mine, o.give)) throw new RuleError("you don't have those cards any more")
  if (!hasCards(theirs, o.get)) throw new RuleError("they don't have those cards any more")
  removeCards(mine, o.give)
  addCards(theirs, o.give)
  removeCards(theirs, o.get)
  addCards(mine, o.get)
  state.offers = state.offers.filter((x) => x !== o)
  log(state, seat, `${nameOf(state, seat)} trades ${describeCards(o.give)} with ${nameOf(state, action.with)} for ${describeCards(o.get)}`)
}

function offerCancel(state: GameState, seat: number, action: Extract<Action, { type: 'offerCancel' }>) {
  const o = state.offers.find((x) => x.id === action.id)
  if (!o) return
  if (o.from !== seat) throw new RuleError("that isn't your offer")
  state.offers = state.offers.filter((x) => x !== o)
}

/* ---- ending a turn ---- */

function endTurn(state: GameState, seat: number, ctx: Ctx) {
  requireActor(state, seat)
  requireRolled(state)
  if (state.config.citiesKnights && progressOverLimit(state, seat)) {
    pushFront(state, ...progressLimitPrompts(state, seat), task('finishEndTurn'))
    runQueue(state, ctx)
    return
  }
  finishEndTurn(state)
}

function finishEndTurn(state: GameState) {
  const t = state.turn
  const n = state.players.filter((p) => !p.resigned).length
  state.offers = []
  if (t.stage.kind === 'main') {
    log(state, t.seat, `${nameOf(state, t.seat)} ends their turn`)
    if (n >= 5 && state.config.largeGameTurns === 'specialBuild') {
      const queue = othersInOrder(state, t.seat)
      t.stage = { kind: 'specialBuild', seat: queue[0], queue: queue.slice(1) }
      log(state, queue[0], `Special build phase: ${nameOf(state, queue[0])}`)
      return
    }
    if (n >= 5 && state.config.largeGameTurns === 'secondSettler') {
      const opposite = oppositeSeat(state, t.seat)
      // The second settler's turn is theirs: its own card, ship and trade allowances.
      t.stage = { kind: 'secondSettler', seat: opposite }
      t.fleet = null
      t.crane = false
      t.devPlayed = false
      t.shipMoved = false
      t.bankTrades = 0
      log(state, opposite, `${nameOf(state, opposite)} takes the second-settler turn`)
      checkVictory(state)
      return
    }
  } else if (t.stage.kind === 'specialBuild') {
    const queue = t.stage.queue.filter((s) => !state.players[s].resigned)
    if (queue.length > 0) {
      const [next, ...rest] = queue
      t.stage = { kind: 'specialBuild', seat: next, queue: rest }
      log(state, next, `Special build phase: ${nameOf(state, next)}`)
      return
    }
  }
  startNextTurn(state)
}

/** The seat across the table, for the second-settler rule. */
export function oppositeSeat(state: GameState, seat: number): number {
  const n = state.players.length
  let s = (seat + Math.floor(n / 2)) % n
  for (let i = 0; i < n && (state.players[s].resigned || s === seat); i++) s = (s + 1) % n
  return s
}

/* ---- roll ---- */

function roll(state: GameState, seat: number, ctx: Ctx) {
  requireActor(state, seat)
  if (stage(state) !== 'main') throw new RuleError('only the first settler rolls')
  if (state.turn.rolled) throw new RuleError('you have already rolled')
  const dice = rollDice(state, ctx)
  state.turn.rolled = true
  state.turn.dice = dice
  const total = dice.a + dice.b
  log(state, seat, `${nameOf(state, seat)} rolls ${total}`, { dice })
  // Cities & Knights resolves the event die first — barbarians or progress
  // cards — and then production.
  const steps = []
  if (state.config.citiesKnights && dice.event === 'barbarian') steps.push(task('barbarianAdvance'))
  if (state.config.citiesKnights && dice.event && dice.event !== 'barbarian') {
    steps.push(task('progressDraw', { track: dice.event, red: dice.b }))
  }
  steps.push(total === 7 ? task('seven') : task('produce', { total }))
  pushFront(state, ...steps)
}

/* ---- resign and timeout ---- */

/** Read through a function so TypeScript doesn't narrow the phase across a dispatch. */
const isOver = (state: GameState) => state.phase === 'ended'

function resign(state: GameState, seat: number) {
  const player = state.players[seat]
  if (player.resigned) return
  if (state.phase === 'ended') throw new RuleError('the game is over')
  player.resigned = true
  log(state, seat, `${player.name} resigns`)
  state.queue = state.queue.filter((s) => s.kind !== 'prompt' || s.seat !== seat)
  state.offers = state.offers.filter((o) => o.from !== seat).map((o) => ({ ...o, to: o.to.filter((s) => s !== seat) }))
  // Their pieces stay on the board, as in a real game where someone leaves.
  if (state.phase === 'setup') {
    // The opening snake can't skip a seat, so a bot finishes the game for them.
    player.resigned = false
    player.bot = true
    log(state, seat, `A bot takes over ${player.name}'s seat`)
    return
  }
  // Their turn — or their slot in a shared or special-build turn — passes on.
  const theirMainTurn = state.turn.seat === seat && state.turn.stage.kind === 'main'
  if (theirMainTurn || actingSeat(state) === seat) {
    state.turn.rolled = true
    state.queue = state.queue.filter((s) => s.kind === 'prompt')
    finishEndTurn(state)
  }
  checkVictory(state)
}

function timeout(state: GameState, ctx: Ctx) {
  if (state.deadline === null || ctx.now < state.deadline) throw new RuleError('there is still time on the clock')
  if (state.phase === 'ended') throw new RuleError('the game is over')
  const stalled = waitingOn(state)
  // Play the stalled seats' turn on autopilot until someone else is up.
  for (let guard = 0; guard < 60; guard++) {
    const now = waitingOn(state)
    if (isOver(state) || now.length === 0 || !now.some((s) => stalled.includes(s))) break
    const seat = now.find((s) => stalled.includes(s))!
    const action = autopilot(state, seat)
    if (!action) break
    dispatch(state, seat, action, ctx)
    runQueue(state, ctx)
  }
  log(state, null, `Time ran out for ${stalled.map((s) => nameOf(state, s)).join(' and ')}`)
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

function dispatch(state: GameState, seat: number, action: Action, ctx: Ctx) {
  switch (action.type) {
    case 'build': return build(state, seat, action, ctx)
    case 'roll': return roll(state, seat, ctx)
    case 'moveShip': return moveShip(state, seat, action)
    case 'buyDev': return buyDev(state, seat)
    case 'playDev': return playDev(state, seat, action)
    case 'tradeBank': return tradeBank(state, seat, action)
    case 'offer': return offer(state, seat, action)
    case 'offerRespond': return offerRespond(state, seat, action)
    case 'offerConfirm': return offerConfirm(state, seat, action)
    case 'offerCancel': return offerCancel(state, seat, action)
    case 'endTurn': return endTurn(state, seat, ctx)
    case 'respond': return respond(state, seat, action, ctx)
    case 'resign': return resign(state, seat)
    case 'timeout': return timeout(state, ctx)
    case 'improve':
    case 'activateKnight':
    case 'promoteKnight':
    case 'moveKnight':
    case 'chaseRobber':
    case 'playProgress':
      if (!state.config.citiesKnights) throw new RuleError('that needs Cities & Knights')
      requireActor(state, seat)
      return ckActions[action.type](state, seat, action, ctx)
    case 'fish':
    case 'passBoot':
      if (!state.config.fishermen) throw new RuleError('that needs Fishermen')
      requireActor(state, seat)
      return fishActions[action.type](state, seat, action, ctx)
    default:
      throw new RuleError('unknown action')
  }
}

const INDEX_FIELDS = ['at', 'from', 'to', 'vertex', 'edge', 'hex', 'with', 'a', 'b'] as const

/** Reject payloads of the wrong shape up front, with a message rather than a crash. */
function validateAction(action: Action) {
  const a = action as Record<string, unknown>
  for (const key of INDEX_FIELDS) {
    if (a[key] !== undefined && (typeof a[key] !== 'number' || !Number.isInteger(a[key]))) {
      throw new RuleError('malformed action')
    }
  }
  for (const key of ['tokens', 'hexes', 'to'] as const) {
    if (a[key] === undefined || (key === 'to' && typeof a[key] === 'number')) continue
    if (!Array.isArray(a[key]) || !(a[key] as unknown[]).every((n) => typeof n === 'number' && Number.isInteger(n))) {
      throw new RuleError('malformed action')
    }
  }
  for (const key of ['prompt', 'choice', 'id', 'card', 'piece', 'track', 'use'] as const) {
    if (a[key] !== undefined && typeof a[key] !== 'string') throw new RuleError('malformed action')
  }
  for (const key of ['cards', 'give', 'get'] as const) {
    if (a[key] !== undefined && (typeof a[key] !== 'object' || a[key] === null || Array.isArray(a[key]))) {
      throw new RuleError('malformed action')
    }
  }
}

/**
 * Nobody may be left waiting on a player who has left: their prompts are
 * answered on autopilot, and a turn they hold passes on.
 */
function settleResigned(state: GameState, ctx: Ctx) {
  for (let guard = 0; guard < 50 && state.phase !== 'ended'; guard++) {
    const stuck = activePrompts(state).find((p) => state.players[p.seat].resigned)
    if (stuck) {
      const answer = autopilot(state, stuck.seat)
      try {
        if (!answer) throw new RuleError('no answer')
        respond(state, stuck.seat, answer as Respond, ctx)
      } catch {
        state.queue.splice(state.queue.indexOf(stuck), 1)
      }
      runQueue(state, ctx)
      continue
    }
    const acting = actingSeat(state)
    if (state.phase === 'main' && acting !== null && state.players[acting].resigned) {
      state.turn.rolled = true
      finishEndTurn(state)
      continue
    }
    return
  }
}

/**
 * Apply one action for one seat. The input state is never modified; the
 * returned state is a fresh copy with the action's consequences worked out.
 */
export function applyAction(input: GameState, seat: number, action: Action, ctx: Ctx): GameState {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') throw new RuleError('malformed action')
  if (!Number.isInteger(seat) || seat < 0 || seat >= input.players.length) throw new RuleError('no such seat')
  if (input.phase === 'ended' && action.type !== 'resign') throw new RuleError('the game is over')
  if (input.players[seat].resigned && action.type !== 'timeout') throw new RuleError('you have resigned')
  validateAction(action)
  const state = structuredClone(input)
  dispatch(state, seat, action, ctx)
  runQueue(state, ctx)
  settleResigned(state, ctx)
  if (state.phase !== 'ended') {
    updateAwards(state)
    checkVictory(state)
  }
  state.seq++
  state.deadline = state.phase !== 'ended' && state.config.turnTimer > 0 ? ctx.now + state.config.turnTimer * 1000 : null
  return state
}

/* ------------------------------------------------------------------ *
 * Queries for the UI
 * ------------------------------------------------------------------ */

export { actingSeat, waitingOn } from './rules'

/** Seats that hold a playable development card this turn. */
export function playableDev(state: GameState, seat: number): DevCardType[] {
  if (state.config.citiesKnights || state.turn.devPlayed) return []
  const out = new Set<DevCardType>()
  for (const d of state.players[seat].dev) {
    if (d.type !== 'victory' && d.bought < state.turn.number) out.add(d.type)
  }
  return [...out]
}

export const handCount = (p: PlayerState) => handSize(p.hand)

export { pieceCounts, nextSeat }
