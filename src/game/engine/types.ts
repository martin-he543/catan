/**
 * The game's data model. Everything here is plain JSON — no classes, no Maps —
 * because a whole game state is stored as one JSON string in Firestore and
 * handed between the browser, the Cloud Function and the tests unchanged.
 *
 * Board positions are integer indices into a `Topology` that is derived from
 * the map's hex list (see hexgrid.ts), so the state never stores geometry.
 */

export const RESOURCES = ['brick', 'lumber', 'ore', 'sheep', 'wheat'] as const
export type Resource = (typeof RESOURCES)[number]

/** Cities & Knights commodities: paper from forest, cloth from pasture, coin from mountains. */
export const COMMODITIES = ['paper', 'cloth', 'coin'] as const
export type Commodity = (typeof COMMODITIES)[number]

export type Card = Resource | Commodity
export const CARDS: readonly Card[] = [...RESOURCES, ...COMMODITIES]

export type Hand = Record<Card, number>
/** A partial set of cards, as used for costs, trades and discards. */
export type CardCounts = Partial<Record<Card, number>>

export type Terrain = Resource | 'desert' | 'gold' | 'sea' | 'lake'

export const isLand = (t: Terrain) => t !== 'sea'

/** Harbour kinds; `any` is the generic 3:1. */
export type HarborType = Resource | 'any'

export const PLAYER_COLORS = ['red', 'blue', 'yellow', 'white', 'green', 'brown', 'purple', 'pink'] as const
export type PlayerColor = (typeof PLAYER_COLORS)[number]

/**
 * How a hex is hidden.
 *  - `fog`: Seafarers fog — lifted when a road or ship is built beside it.
 *  - `blind`: terrain and number hidden until someone builds on a corner.
 *  - `terrain`: the number shows but the terrain is hidden until built beside.
 */
export type Veil = 'fog' | 'blind' | 'terrain'

export interface HexState {
  q: number
  r: number
  terrain: Terrain
  /** Production number 2-12; absent on sea, desert and lake. */
  number?: number
  /** Fishermen: a sea hex that is a fishing ground carries a number. */
  fishing?: number
  veil?: Veil
  /** Land region (island), for Seafarers bonuses and setup restrictions. -1 for sea/desert. */
  region: number
}

/** A harbour on the edge between a land hex and the sea. */
export interface Harbor {
  /** Land hex index. */
  hex: number
  /** Which side of that hex, 0 = NE, clockwise to 5 = NW. */
  side: number
  type: HarborType
}

export interface MapState {
  hexes: HexState[]
  harbors: Harbor[]
  /** Regions where setup placements are allowed. Empty means anywhere. */
  homeRegions: number[]
}

export type BuildingKind = 'settlement' | 'city'
export type Track = 'trade' | 'politics' | 'science'
export const TRACKS: readonly Track[] = ['trade', 'politics', 'science']

export interface Building {
  owner: number
  kind: BuildingKind
  /** C&K city wall (cities only). */
  wall?: boolean
  /** C&K metropolis on this city. */
  metropolis?: Track
}

export type RouteKind = 'road' | 'ship'

export interface Route {
  owner: number
  kind: RouteKind
  /** Turn number the piece was built, so ships built this turn can't sail. */
  built: number
}

export interface Knight {
  owner: number
  /** 1 basic, 2 strong, 3 mighty. */
  level: 1 | 2 | 3
  active: boolean
  /** Turn number it was activated; a knight can't act on the turn it was activated. */
  activated?: number
  /** Turn number it was promoted; once per turn. */
  promoted?: number
  /** Turn number it last moved or acted. */
  acted?: number
}

export type DevCardType = 'knight' | 'victory' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly'

export interface DevCard {
  type: DevCardType
  /** Turn number it was bought; can't be played the same turn. */
  bought: number
}

export type ProgressCardType =
  // Science (green)
  | 'alchemist' | 'crane' | 'engineer' | 'inventor' | 'irrigation' | 'medicine' | 'mining'
  | 'printer' | 'roadBuilding' | 'smith'
  // Trade (yellow)
  | 'commercialHarbor' | 'masterMerchant' | 'merchant' | 'merchantFleet'
  | 'resourceMonopoly' | 'tradeMonopoly'
  // Politics (blue)
  | 'bishop' | 'constitution' | 'deserter' | 'diplomat' | 'intrigue' | 'saboteur' | 'spy'
  | 'warlord' | 'wedding'

export interface ProgressCard {
  type: ProgressCardType
  track: Track
}

export interface Improvements {
  trade: number
  politics: number
  science: number
}

export interface PlayerState {
  name: string
  color: PlayerColor
  bot: boolean
  hand: Hand
  dev: DevCard[]
  /** Knight cards played, for the largest army. */
  knightsPlayed: number
  /** Victory point cards revealed at the end, counted from `dev` until then. */
  progress: ProgressCard[]
  /** Printer, Constitution — played face up. */
  progressPoints: number
  /** C&K Defender of Catan cards. */
  defenderPoints: number
  improvements: Improvements
  /** Fishermen tokens in hand, by value (1-3). */
  fish: number[]
  hasBoot: boolean
  /** Seafarers island bonuses earned. */
  islandPoints: number
  /** Regions this player has already been rewarded for. */
  rewardedRegions: number[]
  /** Regions of this player's setup buildings — never rewarded. */
  homeRegions: number[]
  /** Dice-rolled 7s, for balanced sevens. */
  sevens: number
  /** Conceded players are skipped and can't win. */
  resigned?: boolean
}

export type Phase = 'setup' | 'main' | 'ended'

export interface SetupStep {
  seat: number
  building: BuildingKind
  /** Take one of each resource the building touches (the second placement). */
  gains: boolean
  /** A building already on the board from a starting position; only its road is placed. */
  preset?: number
}

export interface SetupState {
  steps: SetupStep[]
  index: number
  /** The vertex just built, awaiting its road; null while a building is expected. */
  anchor: number | null
}

export type EventFace = 'barbarian' | Track

export interface Dice {
  /** The white (yellow in C&K) die. */
  a: number
  /** The second die (red in C&K). */
  b: number
  event?: EventFace
}

/** A turn is played by one or two seats; this is who may act outside of prompts. */
export type TurnStage =
  | { kind: 'main' }
  /** Official 5-6 player rule: after each turn, the others build in order. */
  | { kind: 'specialBuild'; seat: number; queue: number[] }
  /** TwoSheep's alternative: the seat opposite gets a restricted turn. */
  | { kind: 'secondSettler'; seat: number }

export interface TurnState {
  seat: number
  /** Increments every turn of the main phase, starting at 1. */
  number: number
  rolled: boolean
  dice: Dice | null
  devPlayed: boolean
  shipMoved: boolean
  stage: TurnStage
  /** Merchant Fleet: this card trades 2:1 for the rest of the turn. */
  fleet: Card | null
  /** Crane: next improvement is one commodity cheaper. */
  crane: boolean
  /** Alchemist: the dice values chosen before rolling. */
  alchemist: { a: number; b: number } | null
  /** Bank trades made this turn (bots use it to stop dithering). */
  bankTrades?: number
}

export interface TradeOffer {
  id: string
  from: number
  /** Seats the offer is open to. */
  to: number[]
  give: CardCounts
  get: CardCounts
  accepted: number[]
  rejected: number[]
}

/** What a prompt asks its seat for. */
export type PromptInput =
  | {
      kind: 'cards'
      count: number
      /** Where the cards come from. */
      source: 'hand' | 'bank' | { seat: number }
      /** Restrict to these kinds. */
      allowed?: Card[]
    }
  | {
      kind: 'board'
      vertices?: number[]
      edges?: number[]
      hexes?: number[]
      /** Which route pieces may go on a chosen edge. */
      pieces?: RouteKind[]
      /** How many hexes to pick (Inventor picks two). */
      count?: number
    }
  | { kind: 'choice'; options: Array<{ id: string; label: string }> }

export type PromptType =
  | 'discard' | 'robber' | 'steal' | 'gold' | 'freeRoad'
  | 'cityLoss' | 'defenderPick' | 'progressDiscard' | 'aqueduct'
  | 'displaced' | 'deserterRemove' | 'deserterPlace' | 'wedding'
  | 'masterMerchantSeat' | 'masterMerchantCards' | 'spySeat' | 'spyCard'
  | 'diplomatRemove' | 'diplomatReplace' | 'inventor' | 'merchantPlace'
  | 'commercialHarborGive' | 'commercialHarborReturn' | 'intrigue'
  | 'resourceMonopoly' | 'tradeMonopoly' | 'merchantFleet' | 'medicine'
  | 'engineer' | 'smith' | 'bishop' | 'saboteur' | 'deserterSeat'
  | 'fishSteal' | 'fishResource' | 'fishRoad' | 'fishRobber'
  | 'yearOfPlenty' | 'monopoly' | 'metropolis'

export interface Prompt {
  kind: 'prompt'
  id: string
  /** Prompts sharing a group are answered at the same time, in any order. */
  group: string
  seat: number
  type: PromptType
  text: string
  input: PromptInput
  /** The seat may decline. */
  optional?: boolean
  data?: Record<string, unknown>
}

/** Work the engine does between prompts; run until a prompt is at the front. */
export interface Task {
  kind: 'task'
  task: string
  data?: Record<string, unknown>
}

export type Step = Prompt | Task

export interface LogEntry {
  /** Monotonic action counter when it happened. */
  n: number
  seat: number | null
  text: string
  /** Detail only these seats may see (e.g. which card was stolen). */
  secret?: { seats: number[]; text: string }
  /** Dice, for the log's roll badges. */
  dice?: Dice
}

export interface Award {
  owner: number
  size: number
}

export interface GameState {
  schema: 1
  config: GameConfig
  map: MapState
  players: PlayerState[]
  buildings: Array<Building | null>
  routes: Array<Route | null>
  knights: Array<Knight | null>
  robber: number
  pirate: number
  merchant: { hex: number; owner: number } | null
  phase: Phase
  setup: SetupState | null
  turn: TurnState
  queue: Step[]
  offers: TradeOffer[]
  bank: Hand
  devDeck: DevCardType[]
  progressDecks: Record<Track, ProgressCardType[]>
  /** Fish tokens by value; 0 is the old boot. Spent tokens go to the discard pile. */
  fishDeck: number[]
  fishDiscard: number[]
  /** Balanced dice: the remaining (a, b) pairs, encoded as a*10+b. */
  diceDeck: number[]
  barbarian: { position: number; attacks: number } | null
  metropolis: Record<Track, number | null>
  longestRoad: Award | null
  largestArmy: Award | null
  winner: number | null
  log: LogEntry[]
  /** Number of actions applied so far. */
  seq: number
  /** Counter for prompt and offer ids. */
  ids: number
  /** Dice totals rolled, index 2-12. */
  rolls: number[]
  /** Epoch ms after which the current actor may be timed out; null when off. */
  deadline: number | null
  /** Why the game ended, when it did. */
  endReason?: string
}

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

export type LargeGameTurns = 'none' | 'specialBuild' | 'secondSettler'
export type DiceMode = 'random' | 'balanced'

export interface GameConfig {
  /** Short name of the mode for display. */
  title: string
  players: number
  vpTarget: number
  discardLimit: number
  seafarers: boolean
  citiesKnights: boolean
  fishermen: boolean
  /** Seafarers scenario id, when the map is a scenario. */
  scenario?: string
  /** Seafarers: VP for the first settlement on each new island. */
  islandBonus: number
  friendlyRobber: boolean
  dice: DiceMode
  balancedSevens: boolean
  largeGameTurns: LargeGameTurns
  dustBowl: boolean
  veil: 'none' | 'blind' | 'terrain'
  /** Seconds per turn or prompt before the autopilot steps in; 0 is off. */
  turnTimer: number
  /** Allow trades between players. */
  playerTrades: boolean
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

export type BuildPiece = 'road' | 'ship' | 'settlement' | 'city' | 'wall' | 'knight'

export type Action =
  | { type: 'roll' }
  | { type: 'build'; piece: BuildPiece; at: number }
  | { type: 'moveShip'; from: number; to: number }
  | { type: 'buyDev' }
  | { type: 'playDev'; card: Exclude<DevCardType, 'victory'> }
  | { type: 'tradeBank'; give: CardCounts; get: CardCounts }
  | { type: 'offer'; give: CardCounts; get: CardCounts; to?: number[] }
  | { type: 'offerRespond'; id: string; accept: boolean }
  | { type: 'offerConfirm'; id: string; with: number }
  | { type: 'offerCancel'; id: string }
  | { type: 'endTurn' }
  | {
      type: 'respond'
      prompt: string
      cards?: CardCounts
      vertex?: number
      edge?: number
      hex?: number
      hexes?: number[]
      piece?: RouteKind
      choice?: string
      skip?: boolean
    }
  // Cities & Knights
  | { type: 'improve'; track: Track }
  | { type: 'activateKnight'; at: number }
  | { type: 'promoteKnight'; at: number }
  | { type: 'moveKnight'; from: number; to: number }
  | { type: 'chaseRobber'; at: number }
  | { type: 'playProgress'; card: ProgressCardType; a?: number; b?: number }
  // Fishermen
  | { type: 'fish'; use: FishUse; tokens: number[] }
  | { type: 'passBoot'; to: number }
  // Anyone
  | { type: 'timeout' }
  | { type: 'resign' }

export type FishUse = 'robber' | 'steal' | 'resource' | 'road' | 'dev'

export type ActionType = Action['type']

/** Thrown for an action the rules don't allow; the message is shown to the player. */
export class RuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleError'
  }
}
