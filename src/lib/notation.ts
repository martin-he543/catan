/**
 * CSN — Catan Standard Notation.
 *
 * A plain-text record of a game of Catan, built to feel like chess algebraic
 * notation: a short header describing the starting position, then one numbered
 * line per turn, each a sequence of terse, scannable move tokens.
 *
 *   [Players "1:Red 2:Blue 3:Yellow 4:White"]
 *   [Board "O6 B3 G11 / W12 L9 D G4 / ..."]
 *   [Ports "* G * B O * W * L"]      ; `G>` / `G<` nudges a port one edge along the shore
 *
 *   s1. Sf3 Rf3g3          ; opening settlement + road, seat implied by snake order
 *   ...
 *   1. 8 +2G1O Cf3         ; seat 1 rolls 8, collects, upgrades to a city
 *   2. 7 -3:4 XC3x1G       ; seat 2 rolls 7, seat 3 discards 4, robber to C3, steals a grain
 *
 * Three ideas carry the whole design:
 *
 *  1. **Case encodes scale.** Uppercase A-E names a *tile* row; lowercase a-l
 *     names a *corner* row. `C3` is always a hex, `c3` is always a corner, and
 *     an edge is just its two corners run together: `f3g3`.
 *  2. **Whose turn it is is never written.** Seating order is fixed for a whole
 *     game, so — exactly as in chess — the turn number determines the player.
 *     Only cross-player events (trades, steals, discards) name a seat.
 *  3. **One sigil per verb.** Every token starts with a character that says what
 *     kind of thing it is, so a game reads at a glance and parses unambiguously.
 *
 * See `NOTATION_REFERENCE` for the table the UI renders.
 */
import { HEX_CENTERS, PORTS, VERTEX_NEIGHBOURS, hasPortShifts, portShiftsValid } from './geometry'
import type { Game, PortType, Tile, TileType } from './types'

/* ------------------------------------------------------------------ *
 * Coordinates
 * ------------------------------------------------------------------ */

/** Land rows A-E, top to bottom. */
export const HEX_ROW_SIZES = [3, 4, 5, 4, 3]
/** Corner rows a-l, top to bottom. 54 corners in all. */
export const VERTEX_ROW_SIZES = [3, 4, 4, 5, 5, 6, 6, 5, 5, 4, 4, 3]

function buildLabels(sizes: readonly number[], alphabet: string): string[] {
  const out: string[] = []
  sizes.forEach((count, row) => {
    for (let col = 0; col < count; col++) out.push(`${alphabet[row]}${col + 1}`)
  })
  return out
}

/** `A1` … `E3`, indexed to match `HEX_CENTERS` / `Game.tiles`. */
export const HEX_LABELS = buildLabels(HEX_ROW_SIZES, 'ABCDE')
/** `a1` … `l3`, indexed to match `VERTICES`. */
export const VERTEX_LABELS = buildLabels(VERTEX_ROW_SIZES, 'abcdefghijkl')

const HEX_BY_LABEL = new Map(HEX_LABELS.map((l, i) => [l, i]))
const VERTEX_BY_LABEL = new Map(VERTEX_LABELS.map((l, i) => [l, i]))

/** Tile index for a label such as `C3`, or -1. */
export const hexIndex = (label: string): number => HEX_BY_LABEL.get(label) ?? -1
/** Corner index for a label such as `f3`, or -1. */
export const vertexIndex = (label: string): number => VERTEX_BY_LABEL.get(label) ?? -1

/**
 * The nine port berths, named by the tile edge each one serves — `A1-nw`,
 * `C5-e`, and so on. Derived from the geometry rather than written out, so a
 * port can always be pointed at unambiguously.
 */
export const PORT_SLOT_LABELS = PORTS.map((p) => `${HEX_LABELS[p.tile]}-${p.dir}`)

/** An edge, always stored with the lower corner index first. */
export type Edge = readonly [number, number]

/** The 72 road slots, each as its ordered corner pair. */
export const EDGES: Edge[] = (() => {
  const out: Edge[] = []
  VERTEX_NEIGHBOURS.forEach((neighbours, a) => {
    for (const b of neighbours) if (a < b) out.push([a, b])
  })
  return out.sort((p, q) => p[0] - q[0] || p[1] - q[1])
})()

const EDGE_KEYS = new Set(EDGES.map(([a, b]) => `${a}:${b}`))

/** Is this pair of corners a legal road slot? */
export function isEdge(a: number, b: number): boolean {
  return EDGE_KEYS.has(a < b ? `${a}:${b}` : `${b}:${a}`)
}

/** `f3g4` — the two corners of a road, in board reading order. */
export function edgeLabel(a: number, b: number): string {
  const [lo, hi] = a < b ? [a, b] : [b, a]
  return VERTEX_LABELS[lo] + VERTEX_LABELS[hi]
}

/* ------------------------------------------------------------------ *
 * Resources, tiles and ports
 * ------------------------------------------------------------------ */

/**
 * Resource letters follow Catan's own card names — Brick, Lumber, Ore, Grain,
 * Wool — which happen to be five distinct initials, unlike brick/wheat/sheep.
 */
export const RESOURCE_CODES = ['B', 'L', 'O', 'G', 'W'] as const
export type ResourceCode = (typeof RESOURCE_CODES)[number]

const TILE_BY_CODE: Record<string, TileType> = {
  B: 'brick', L: 'lumber', O: 'ore', G: 'wheat', W: 'sheep', D: 'desert',
}
const CODE_BY_TILE: Record<TileType, string> = {
  brick: 'B', lumber: 'L', ore: 'O', wheat: 'G', sheep: 'W', desert: 'D',
}

/** Letter for a tile or resource, e.g. `wheat` -> `G`. */
export const tileCode = (type: TileType): string => CODE_BY_TILE[type]
/** Tile type for a letter, or null. */
export const codeTile = (code: string): TileType | null => TILE_BY_CODE[code] ?? null

/** A hand or payment, e.g. `2G1O`. `hidden` counts cards of unknown type. */
export type Cards = Partial<Record<ResourceCode, number>> & { hidden?: number }

const PORT_CODE_BY_TYPE: Record<PortType, string> = {
  '31': '*', brick: 'B', lumber: 'L', ore: 'O', wheat: 'G', sheep: 'W',
}
const PORT_TYPE_BY_CODE: Record<string, PortType> = {
  '*': '31', B: 'brick', L: 'lumber', O: 'ore', G: 'wheat', W: 'sheep',
}

/* ------------------------------------------------------------------ *
 * Board serialisation
 * ------------------------------------------------------------------ */

/**
 * The 19 tiles as five `/`-separated rows, mirroring the shape of the island:
 * `O6 B3 G11 / W12 L9 D G4 / ...`. The desert carries no number.
 */
export function serializeBoard(tiles: readonly Tile[]): string {
  const rows: string[] = []
  let i = 0
  for (const size of HEX_ROW_SIZES) {
    const row: string[] = []
    for (let c = 0; c < size; c++, i++) {
      const tile = tiles[i]
      row.push(tile.blank ? '?' : tile.type === 'desert' ? 'D' : `${tileCode(tile.type)}${tile.number}`)
    }
    rows.push(row.join(' '))
  }
  return rows.join(' / ')
}

const SHIFT_MARK: Record<number, string> = { [-1]: '<', 0: '', 1: '>' }

/**
 * The nine ports in the board's fixed order; `*` is a 3:1. A trailing `>` or
 * `<` moves that port one shoreline edge clockwise or anticlockwise.
 */
export function serializePorts(ports: readonly PortType[], shifts?: readonly number[]): string {
  return ports.map((p, i) => PORT_CODE_BY_TYPE[p] + (SHIFT_MARK[shifts?.[i] ?? 0] ?? '')).join(' ')
}

export interface ParseIssue {
  line: number
  message: string
}

/** Parse a `[Board ...]` string. Returns tiles, or null with `issues` filled. */
export function parseBoard(text: string, issues: ParseIssue[] = [], line = 0): Tile[] | null {
  const tokens = text.trim().split(/[\s/]+/).filter(Boolean)
  if (tokens.length !== 19) {
    issues.push({ line, message: `board needs 19 tiles, found ${tokens.length}` })
    return null
  }

  const tiles: Tile[] = []
  for (const token of tokens) {
    if (token === '?') {
      tiles.push({ type: 'desert', number: 7, blank: true })
      continue
    }
    const match = /^([BLOGWD])(\d{1,2})?$/.exec(token)
    if (!match) {
      issues.push({ line, message: `not a tile: "${token}"` })
      return null
    }
    const type = codeTile(match[1])!
    if (type === 'desert') {
      tiles.push({ type, number: 7 })
      continue
    }
    const number = Number(match[2])
    if (!match[2] || number < 2 || number > 12 || number === 7) {
      issues.push({ line, message: `"${token}" needs a number token of 2-12 (not 7)` })
      return null
    }
    tiles.push({ type, number })
  }
  return tiles
}

function readPorts(text: string, issues: ParseIssue[], line: number) {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  if (tokens.length !== 9) {
    issues.push({ line, message: `board needs 9 ports, found ${tokens.length}` })
    return null
  }
  const ports: PortType[] = []
  const shifts: number[] = []
  for (const token of tokens) {
    const match = /^(.)([<>]?)$/.exec(token)
    const type = match ? PORT_TYPE_BY_CODE[match[1]] : undefined
    if (!type) {
      issues.push({ line, message: `not a port: "${token}"` })
      return null
    }
    ports.push(type)
    shifts.push(match![2] === '>' ? 1 : match![2] === '<' ? -1 : 0)
  }
  if (!portShiftsValid(shifts)) {
    issues.push({ line, message: 'two nudged ports would share a corner' })
    return { ports, shifts: null }
  }
  return { ports, shifts: hasPortShifts(shifts) ? shifts : null }
}

/** Parse a `[Ports ...]` string into the nine port types. */
export function parsePorts(text: string, issues: ParseIssue[] = [], line = 0): PortType[] | null {
  return readPorts(text, issues, line)?.ports ?? null
}

/** The shoreline nudges written into a `[Ports ...]` string, or null for none. */
export function parsePortShifts(text: string, issues: ParseIssue[] = [], line = 0): number[] | null {
  return readPorts(text, issues, line)?.shifts ?? null
}

/* ------------------------------------------------------------------ *
 * Moves
 * ------------------------------------------------------------------ */

export type DevCard = 'k' | 'v' | 'r' | 'y' | 'm' | '?'

export const DEV_CARD_LABELS: Record<DevCard, string> = {
  k: 'Knight',
  v: 'Victory point',
  r: 'Road building',
  y: 'Year of plenty',
  m: 'Monopoly',
  '?': 'Face down',
}

/** Who the other side of a trade is: a seat number, the bank, or a port. */
export type TradePartner = number | 'bank' | 'port'

export type Action =
  | { kind: 'settlement'; vertex: number }
  | { kind: 'city'; vertex: number }
  | { kind: 'road'; edge: Edge }
  | { kind: 'gain'; seat: number | null; cards: Cards }
  | { kind: 'loss'; seat: number | null; cards: Cards }
  | { kind: 'robber'; hex: number; stealFrom: number | null; stolen: ResourceCode | null }
  | { kind: 'buy'; card: DevCard }
  | { kind: 'play'; card: DevCard; take: Cards | null; monopoly: ResourceCode | null; roads: Edge[] }
  | { kind: 'trade'; partner: TradePartner; give: Cards; get: Cards }
  | { kind: 'award'; award: 'LR' | 'LA' }
  | { kind: 'result'; seat: number; points: number | null }

export interface Move {
  action: Action
  /** Chess-style commentary: `!`, `?`, `!?`, … */
  annotation: string
  /** The token exactly as written, so round-tripping is lossless. */
  text: string
}

export type Phase = 'setup' | 'play'

export interface Turn {
  phase: Phase
  /** `1`-`8` during setup (`s1.`…), then `1`, `2`, … for the main game. */
  number: number
  /** Seat 1-based, derived from the turn number and seat count. */
  seat: number
  /** 2-12, or null when no dice were rolled. */
  roll: number | null
  moves: Move[]
  comment: string | null
  line: number
}

export interface Player {
  seat: number
  name: string
}

export interface CsnGame {
  tags: Record<string, string>
  players: Player[]
  tiles: Tile[] | null
  ports: PortType[] | null
  /** Per-port shoreline nudges from `[Ports]`, or null when none are written. */
  portShifts: number[] | null
  turns: Turn[]
  issues: ParseIssue[]
}

/** Opening placements snake out and back: 1,2,3,4,4,3,2,1. */
export function setupSeat(step: number, seats: number): number {
  const i = step - 1
  return i < seats ? i + 1 : seats * 2 - i
}

/** Seat to move on turn `n`, counting from seat 1. */
export const turnSeat = (n: number, seats: number): number => ((n - 1) % seats) + 1

/* ---- card lists ---- */

function parseCards(text: string, issues: ParseIssue[], line: number): Cards | null {
  const cards: Cards = {}
  // A bare number is a count of unknown cards: `-3:4` discards four of something.
  if (/^\d+$/.test(text)) {
    cards.hidden = Number(text)
    return cards
  }
  const pattern = /(\d*)([BLOGW?])/gy
  let at = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    at = pattern.lastIndex
    const count = match[1] === '' ? 1 : Number(match[1])
    if (match[2] === '?') cards.hidden = (cards.hidden ?? 0) + count
    else {
      const code = match[2] as ResourceCode
      cards[code] = (cards[code] ?? 0) + count
    }
  }
  if (at !== text.length || text.length === 0) {
    issues.push({ line, message: `not a card list: "${text}"` })
    return null
  }
  return cards
}

/**
 * Render a card list, e.g. `{ G: 2, O: 1 }` -> `2G1O`.
 *
 * Resources come out in the order they went in, so a token a human wrote reads
 * back exactly as they wrote it rather than being silently reshuffled.
 */
export function formatCards(cards: Cards): string {
  let out = ''
  for (const key of Object.keys(cards)) {
    const count = cards[key as ResourceCode]
    if (key !== 'hidden' && count) out += `${count}${key}`
  }
  if (cards.hidden) out += out === '' ? `${cards.hidden}` : `${cards.hidden}?`
  return out || '0'
}

/** Total number of cards, known and unknown. */
export const countCards = (cards: Cards): number =>
  RESOURCE_CODES.reduce((sum, code) => sum + (cards[code] ?? 0), 0) + (cards.hidden ?? 0)

/* ---- single tokens ---- */

const ANNOTATION = /([!?]{1,2})$/

function parseVertexAt(label: string, issues: ParseIssue[], line: number): number | null {
  const index = vertexIndex(label)
  if (index < 0) {
    issues.push({ line, message: `no such corner: "${label}"` })
    return null
  }
  return index
}

function parseEdgeToken(text: string, issues: ParseIssue[], line: number): Edge | null {
  const match = /^([a-l]\d+)([a-l]\d+)$/.exec(text)
  if (!match) {
    issues.push({ line, message: `not a road: "${text}"` })
    return null
  }
  const a = parseVertexAt(match[1], issues, line)
  const b = parseVertexAt(match[2], issues, line)
  if (a === null || b === null) return null
  if (!isEdge(a, b)) {
    issues.push({ line, message: `${match[1]} and ${match[2]} are not adjacent` })
    return null
  }
  return a < b ? [a, b] : [b, a]
}

/** Split `2G>1O` into the two halves of a trade. */
function parseSwap(text: string, issues: ParseIssue[], line: number) {
  const [give, get, ...rest] = text.split('>')
  if (get === undefined || rest.length > 0) {
    issues.push({ line, message: `a trade reads "give>get", not "${text}"` })
    return null
  }
  const giveCards = parseCards(give, issues, line)
  const getCards = parseCards(get, issues, line)
  if (!giveCards || !getCards) return null
  return { give: giveCards, get: getCards }
}

/** Parse one whitespace-delimited move token. */
export function parseAction(token: string, issues: ParseIssue[], line = 0): Action | null {
  const sigil = token[0]
  const rest = token.slice(1)

  switch (sigil) {
    case 'S':
    case 'C': {
      const vertex = parseVertexAt(rest, issues, line)
      if (vertex === null) return null
      return sigil === 'S' ? { kind: 'settlement', vertex } : { kind: 'city', vertex }
    }

    case 'R': {
      const edge = parseEdgeToken(rest, issues, line)
      return edge && { kind: 'road', edge }
    }

    case '+':
    case '-': {
      // `+2G1O` for the player to move, `+3:1L` for somebody else.
      const split = rest.indexOf(':')
      const seat = split < 0 ? null : Number(rest.slice(0, split))
      if (seat !== null && !Number.isInteger(seat)) {
        issues.push({ line, message: `not a seat: "${rest.slice(0, split)}"` })
        return null
      }
      const cards = parseCards(split < 0 ? rest : rest.slice(split + 1), issues, line)
      if (!cards) return null
      return sigil === '+' ? { kind: 'gain', seat, cards } : { kind: 'loss', seat, cards }
    }

    case 'X': {
      // `XC3`, `XC3x2` (steal from seat 2), `XC3x2G` (a grain, when it's known).
      const match = /^([A-E]\d)(?:x(\d)([BLOGW])?)?$/.exec(rest)
      if (!match) {
        issues.push({ line, message: `not a robber move: "${token}"` })
        return null
      }
      const hex = hexIndex(match[1])
      if (hex < 0) {
        issues.push({ line, message: `no such tile: "${match[1]}"` })
        return null
      }
      return {
        kind: 'robber',
        hex,
        stealFrom: match[2] ? Number(match[2]) : null,
        stolen: (match[3] as ResourceCode | undefined) ?? null,
      }
    }

    case 'D': {
      if (!/^[kvrym?]$/.test(rest)) {
        issues.push({ line, message: `not a development card: "${token}"` })
        return null
      }
      return { kind: 'buy', card: rest as DevCard }
    }

    case 'P': {
      const card = rest[0] as DevCard
      const payload = rest.slice(1).replace(/^:/, '')
      if (!/^[krym]$/.test(card ?? '')) {
        issues.push({ line, message: `"${token}" is not a playable card` })
        return null
      }
      const action: Action = { kind: 'play', card, take: null, monopoly: null, roads: [] }
      if (card === 'y') {
        const take = parseCards(payload, issues, line)
        if (!take) return null
        action.take = take
      } else if (card === 'm') {
        if (!/^[BLOGW]$/.test(payload)) {
          issues.push({ line, message: `monopoly needs one resource, got "${payload}"` })
          return null
        }
        action.monopoly = payload as ResourceCode
      } else if (card === 'r' && payload !== '') {
        for (const part of payload.split('+')) {
          const edge = parseEdgeToken(part, issues, line)
          if (!edge) return null
          action.roads.push(edge)
        }
      } else if (payload !== '') {
        issues.push({ line, message: `"${DEV_CARD_LABELS[card]}" takes no argument` })
        return null
      }
      return action
    }

    case 'T': {
      // `T2:` a player, `Tb:` the bank, `Tp:` a port.
      const split = rest.indexOf(':')
      if (split < 0) {
        issues.push({ line, message: `a trade names a partner: "${token}"` })
        return null
      }
      const who = rest.slice(0, split)
      const partner: TradePartner | null =
        who === 'b' ? 'bank' : who === 'p' ? 'port' : /^\d+$/.test(who) ? Number(who) : null
      if (partner === null) {
        issues.push({ line, message: `not a trade partner: "${who}"` })
        return null
      }
      const swap = parseSwap(rest.slice(split + 1), issues, line)
      return swap && { kind: 'trade', partner, ...swap }
    }

    case '^': {
      if (rest !== 'LR' && rest !== 'LA') {
        issues.push({ line, message: `awards are ^LR or ^LA, not "${token}"` })
        return null
      }
      return { kind: 'award', award: rest }
    }

    case '#': {
      const match = /^(\d+)(?::(\d+))?$/.exec(rest)
      if (!match) {
        issues.push({ line, message: `not a result: "${token}"` })
        return null
      }
      return { kind: 'result', seat: Number(match[1]), points: match[2] ? Number(match[2]) : null }
    }

    default:
      issues.push({ line, message: `unknown move: "${token}"` })
      return null
  }
}

/** Render one action back to its token. */
export function formatAction(action: Action): string {
  switch (action.kind) {
    case 'settlement':
      return `S${VERTEX_LABELS[action.vertex]}`
    case 'city':
      return `C${VERTEX_LABELS[action.vertex]}`
    case 'road':
      return `R${edgeLabel(action.edge[0], action.edge[1])}`
    case 'gain':
    case 'loss': {
      const sigil = action.kind === 'gain' ? '+' : '-'
      const who = action.seat === null ? '' : `${action.seat}:`
      return `${sigil}${who}${formatCards(action.cards)}`
    }
    case 'robber': {
      const steal =
        action.stealFrom === null ? '' : `x${action.stealFrom}${action.stolen ?? ''}`
      return `X${HEX_LABELS[action.hex]}${steal}`
    }
    case 'buy':
      return `D${action.card}`
    case 'play': {
      if (action.card === 'y') return `Py:${formatCards(action.take ?? {})}`
      if (action.card === 'm') return `Pm:${action.monopoly}`
      if (action.card === 'r' && action.roads.length > 0) {
        return `Pr:${action.roads.map(([a, b]) => edgeLabel(a, b)).join('+')}`
      }
      return `P${action.card}`
    }
    case 'trade': {
      const who = action.partner === 'bank' ? 'b' : action.partner === 'port' ? 'p' : action.partner
      return `T${who}:${formatCards(action.give)}>${formatCards(action.get)}`
    }
    case 'award':
      return `^${action.award}`
    case 'result':
      return `#${action.seat}${action.points === null ? '' : `:${action.points}`}`
  }
}

/* ------------------------------------------------------------------ *
 * Whole documents
 * ------------------------------------------------------------------ */

const TAG = /^\[(\w+)\s+"([^"]*)"\]$/
const TURN = /^(s?)(\d+)\.\s*(.*)$/

function parsePlayers(text: string): Player[] {
  const players: Player[] = []
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    const match = /^(\d+):(.*)$/.exec(token)
    if (match) players.push({ seat: Number(match[1]), name: match[2] || `Seat ${match[1]}` })
    else players.push({ seat: players.length + 1, name: token })
  }
  return players.sort((a, b) => a.seat - b.seat)
}

/**
 * Parse a whole CSN document. Never throws: anything it could not understand
 * lands in `issues`, and every line it *could* read is still returned.
 */
export function parseCsn(source: string): CsnGame {
  const issues: ParseIssue[] = []
  const tags: Record<string, string> = {}
  const tagLines: Record<string, number> = {}
  /** Turns are collected with their raw tokens, then finished once seats are known. */
  const pending: Array<{ turn: Turn; tokens: string[] }> = []

  source.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    const semicolon = raw.indexOf(';')
    const body = (semicolon < 0 ? raw : raw.slice(0, semicolon)).trim()
    const comment = semicolon < 0 ? null : raw.slice(semicolon + 1).trim() || null
    if (body === '') return

    const tag = TAG.exec(body)
    if (tag) {
      tags[tag[1]] = tag[2]
      tagLines[tag[1]] = line
      return
    }

    const turn = TURN.exec(body)
    if (!turn) {
      issues.push({ line, message: `expected a tag or a numbered turn, got "${body}"` })
      return
    }
    pending.push({
      turn: {
        phase: turn[1] === 's' ? 'setup' : 'play',
        number: Number(turn[2]),
        seat: 0, // filled in below, once the seat count is known
        roll: null,
        moves: [],
        comment,
        line,
      },
      tokens: turn[3].split(/\s+/).filter(Boolean),
    })
  })

  const players = parsePlayers(tags.Players ?? '1:Red 2:Blue 3:Yellow 4:White')
  const seats = Math.max(players.length, 2)

  for (const { turn, tokens } of pending) {
    turn.seat =
      turn.phase === 'setup' ? setupSeat(turn.number, seats) : turnSeat(turn.number, seats)

    let start = 0
    // A leading bare number is the dice roll; `-` says none was made.
    if (tokens[0] !== undefined && /^(\d+|-)$/.test(tokens[0])) {
      turn.roll = tokens[0] === '-' ? null : Number(tokens[0])
      if (turn.roll !== null && (turn.roll < 2 || turn.roll > 12)) {
        issues.push({ line: turn.line, message: `impossible roll: ${turn.roll}` })
        turn.roll = null
      }
      start = 1
    }

    for (const token of tokens.slice(start)) {
      const note = ANNOTATION.exec(token)
      const bare = note ? token.slice(0, -note[1].length) : token
      const action = parseAction(bare, issues, turn.line)
      if (action) turn.moves.push({ action, annotation: note?.[1] ?? '', text: token })
    }
  }

  const tiles = tags.Board ? parseBoard(tags.Board, issues, tagLines.Board) : null
  const portTag = tags.Ports ? readPorts(tags.Ports, issues, tagLines.Ports) : null
  const ports = portTag?.ports ?? null
  const portShifts = portTag?.shifts ?? null

  issues.sort((a, b) => a.line - b.line)
  return { tags, players, tiles, ports, portShifts, turns: pending.map((p) => p.turn), issues }
}

/** Render a parsed game back to CSN. */
export function formatCsn(game: CsnGame): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(game.tags)) lines.push(`[${key} "${value}"]`)
  if (lines.length > 0) lines.push('')

  let phase: Phase | null = null
  for (const turn of game.turns) {
    if (phase !== null && phase !== turn.phase) lines.push('')
    phase = turn.phase
    const prefix = `${turn.phase === 'setup' ? 's' : ''}${turn.number}.`
    const roll = turn.phase === 'play' ? ` ${turn.roll ?? '-'}` : ''
    const moves = turn.moves.map((m) => formatAction(m.action) + m.annotation)
    const comment = turn.comment ? `  ; ${turn.comment}` : ''
    lines.push(`${prefix}${roll} ${moves.join(' ')}`.trimEnd() + comment)
  }
  return lines.join('\n')
}

/** The header for a board with no moves played yet — what Import produces. */
export function boardToCsn(game: Game, tags: Record<string, string> = {}): string {
  const header: Record<string, string> = {
    ...tags,
    Board: serializeBoard(game.tiles),
    Ports: serializePorts(game.ports, game.portShifts),
  }
  return Object.entries(header)
    .map(([key, value]) => `[${key} "${value}"]`)
    .join('\n')
}

/* ------------------------------------------------------------------ *
 * Replay
 * ------------------------------------------------------------------ */

export interface SeatState {
  seat: number
  settlements: number[]
  cities: number[]
  roads: Edge[]
  /** Only as accurate as the record: hidden cards are tracked as `hidden`. */
  cards: Cards
  devCards: DevCard[]
  knightsPlayed: number
  awards: Array<'LR' | 'LA'>
}

export interface Position {
  seats: SeatState[]
  /** Tile the robber sits on; starts on the desert. */
  robber: number
  turnsPlayed: number
}

function emptySeat(seat: number): SeatState {
  return {
    seat,
    settlements: [],
    cities: [],
    roads: [],
    cards: {},
    devCards: [],
    knightsPlayed: 0,
    awards: [],
  }
}

function addCards(into: Cards, from: Cards, sign: 1 | -1) {
  for (const code of RESOURCE_CODES) {
    if (from[code]) into[code] = (into[code] ?? 0) + sign * from[code]!
  }
  if (from.hidden) into.hidden = (into.hidden ?? 0) + sign * from.hidden
}

/**
 * Walk the turns and build the position they describe.
 *
 * This is a bookkeeper, not a referee: it trusts the record rather than
 * checking the rules, so a partial or shorthand game still replays.
 */
export function replay(game: CsnGame, upTo = Infinity): Position {
  const count = Math.max(game.players.length, 2)
  const seats = Array.from({ length: count }, (_, i) => emptySeat(i + 1))
  const at = (seat: number) => seats[seat - 1] ?? seats[0]
  const desert = game.tiles?.findIndex((t) => t.type === 'desert') ?? -1

  const position: Position = {
    seats,
    robber: desert < 0 ? HEX_CENTERS.length - 1 : desert,
    turnsPlayed: 0,
  }

  for (const turn of game.turns.slice(0, upTo)) {
    const me = at(turn.seat)
    position.turnsPlayed++

    for (const { action } of turn.moves) {
      switch (action.kind) {
        case 'settlement':
          me.settlements.push(action.vertex)
          break
        case 'city':
          me.settlements = me.settlements.filter((v) => v !== action.vertex)
          me.cities.push(action.vertex)
          break
        case 'road':
          me.roads.push(action.edge)
          break
        case 'gain':
          addCards(at(action.seat ?? turn.seat).cards, action.cards, 1)
          break
        case 'loss':
          addCards(at(action.seat ?? turn.seat).cards, action.cards, -1)
          break
        case 'robber':
          position.robber = action.hex
          if (action.stealFrom !== null) {
            const taken: Cards = action.stolen ? { [action.stolen]: 1 } : { hidden: 1 }
            addCards(at(action.stealFrom).cards, taken, -1)
            addCards(me.cards, taken, 1)
          }
          break
        case 'buy':
          me.devCards.push(action.card)
          break
        case 'play': {
          // Playing spends the card; an unrecorded buy shows up as a face-down one.
          const i = me.devCards.indexOf(action.card)
          if (i >= 0) me.devCards.splice(i, 1)
          if (action.card === 'k') me.knightsPlayed++
          if (action.card === 'y' && action.take) addCards(me.cards, action.take, 1)
          if (action.card === 'r') me.roads.push(...action.roads)
          break
        }
        case 'trade': {
          addCards(me.cards, action.give, -1)
          addCards(me.cards, action.get, 1)
          if (typeof action.partner === 'number') {
            const them = at(action.partner)
            addCards(them.cards, action.give, 1)
            addCards(them.cards, action.get, -1)
          }
          break
        }
        case 'award':
          // Only one player holds each award at a time.
          for (const seat of seats) seat.awards = seat.awards.filter((a) => a !== action.award)
          me.awards.push(action.award)
          break
        case 'result':
          break
      }
    }
  }

  return position
}

/** Public victory points: settlements, cities and the two awards. */
export function visiblePoints(seat: SeatState): number {
  return seat.settlements.length + seat.cities.length * 2 + seat.awards.length * 2
}

/* ------------------------------------------------------------------ *
 * Reference, rendered by the notation guide in the UI
 * ------------------------------------------------------------------ */

export interface ReferenceRow {
  token: string
  meaning: string
}

export interface ReferenceSection {
  title: string
  blurb: string
  rows: ReferenceRow[]
}

export const NOTATION_REFERENCE: ReferenceSection[] = [
  {
    title: 'Coordinates',
    blurb:
      'Capitals name tiles, lowercase names corners. Rows run top to bottom, numbers left to right.',
    rows: [
      { token: 'A1 … E3', meaning: 'Tile. Five rows A-E of 3, 4, 5, 4, 3 hexes.' },
      { token: 'a1 … l3', meaning: 'Corner. Twelve rows a-l, 54 corners in all.' },
      { token: 'f3g3', meaning: 'Edge (a road): the two corners it joins, run together.' },
      { token: 'B L O G W', meaning: 'Brick, Lumber, Ore, Grain, Wool. D is the desert.' },
      { token: '1 2 3 4', meaning: 'Seats, in turn order. Named once in the Players tag.' },
    ],
  },
  {
    title: 'Header',
    blurb: 'Tags describe the starting position. Board and Ports are all a board needs.',
    rows: [
      { token: '[Board "O6 B3 G11 / …"]', meaning: '19 tiles in five rows. The desert is a bare D.' },
      { token: '[Ports "* G * B O * W * L"]', meaning: 'The nine ports clockwise. * is a 3:1.' },
      { token: '[Ports "* G> * B O< * W * L"]', meaning: 'A trailing > or < moves that port one shore edge clockwise or anticlockwise.' },
      { token: '[Players "1:Ana 2:Sam"]', meaning: 'Seats, in turn order. Defaults to four.' },
      { token: '[Date "2026.09.27"]', meaning: 'Any other tag is free-form and kept as written.' },
    ],
  },
  {
    title: 'Turns',
    blurb:
      "Whose turn it is is never written down — the turn number says it, exactly as in chess.",
    rows: [
      { token: 's1. Sf3 Rf3g3', meaning: 'Opening placement 1 of 8. Seats snake 1-2-3-4-4-3-2-1.' },
      { token: '7. 8 +2G1O', meaning: 'Turn 7 (seat 3 of 4) rolls an 8 and collects.' },
      { token: '9. - Dk', meaning: 'A dash means no dice were rolled.' },
      { token: '; anything', meaning: 'A semicolon starts a comment, to end of line.' },
    ],
  },
  {
    title: 'Building',
    blurb: 'One sigil per verb, so a game stays scannable.',
    rows: [
      { token: 'Sf3', meaning: 'Build a settlement at corner f3.' },
      { token: 'Cf3', meaning: 'Upgrade f3 to a city.' },
      { token: 'Rf3g3', meaning: 'Build a road from f3 to g3.' },
      { token: '^LR  ^LA', meaning: 'Took Longest Road / Largest Army.' },
      { token: '#2:10', meaning: 'Seat 2 wins with 10 points.' },
    ],
  },
  {
    title: 'Cards',
    blurb: 'Gains and losses are optional, but they make a record replayable.',
    rows: [
      { token: '+2G1O', meaning: 'The player to move gains 2 grain and 1 ore.' },
      { token: '+3:1L', meaning: 'Seat 3 gains a lumber.' },
      { token: '-2:4', meaning: 'Seat 2 discards four cards, types unrecorded.' },
      { token: 'Dk  D?', meaning: 'Bought a knight / bought a card you could not see.' },
      { token: 'Pk  Pm:W  Py:1G1O', meaning: 'Played knight / monopoly on wool / year of plenty.' },
      { token: 'Pr:f3g3+g3h3', meaning: 'Played road building, and where the two roads went.' },
    ],
  },
  {
    title: 'Robber and trades',
    blurb: 'x marks a steal, the way it marks a capture in chess.',
    rows: [
      { token: 'XC3', meaning: 'Move the robber to tile C3.' },
      { token: 'XC3x2', meaning: '… and steal an unseen card from seat 2.' },
      { token: 'XC3x2G', meaning: '… and steal a grain, when you saw which it was.' },
      { token: 'T2:2G>1O', meaning: 'Trade with seat 2: give 2 grain, get 1 ore.' },
      { token: 'Tb:4W>1B', meaning: 'Trade with the bank at 4:1.' },
      { token: 'Tp:2O>1G', meaning: 'Trade through a port; the ratio speaks for itself.' },
    ],
  },
  {
    title: 'Commentary',
    blurb: 'Chess annotation marks work unchanged, on any move.',
    rows: [
      { token: 'Sf3!', meaning: 'A good move.' },
      { token: 'XC3x2?', meaning: 'A mistake — you just made an enemy.' },
      { token: 'Tb:4W>1B?!', meaning: 'Dubious. Also: !!, ??, !?' },
    ],
  },
  {
    title: 'Positions',
    blurb: 'A snapshot instead of a history, like a chess FEN. Each seat lists what it has out.',
    rows: [
      { token: '[Position "Sf3 Rf3g3 / Sg2"]', meaning: "Each seat's pieces, in seat order, split by /." },
      { token: '-', meaning: 'A seat with nothing on the board yet.' },
      { token: 'K2  V1', meaning: 'Two knights played; one victory point card held.' },
      { token: '^LR  ^LA', meaning: 'Holds the award. Only needed to settle a tie.' },
      { token: '[Robber "C2"]', meaning: 'Where the robber stands. Defaults to the desert.' },
    ],
  },
]

/**
 * A complete game, used both as the worked example in the guide and as the
 * suite's parse fixture — so the documentation cannot drift from the parser.
 */
export const NOTATION_EXAMPLE = `[Event "Friday night"]
[Date "2026.09.27"]
[Players "1:Ana 2:Sam 3:Kit 4:Joe"]
[Board "O6 B3 G11 / W12 L9 D G4 / L5 B10 O8 W4 G9 / W6 L3 B5 G10 / O11 L2 W8"]
[Ports "* G * B O * W * L"]

s1. Sf3 Rf3g3
s2. Sg2 Rg2h2
s3. Sg4 Rg4h4
s4. Si4 Ri4j4
s5. Sc2 Rb2c2 +1O1B1L      ; second settlements pay out at once
s6. Sf5 Re5f5 +2G1W
s7. Si2 Ri2j2 +1W1L1O
s8. Sh5 Rh5i5 +2G

1.  8 +1O +3:1O +4:1W Rg3h3
2.  5 +1L +3:1B +4:1B Rh2i2
3.  7 XC2x1!               ; brick 10 blocked, and a card off Ana
4.  9 +1L +1:1L1G +3:1G Dk
5.  6 +2:2W +4:1O Rh3i3
6.  11 +1O Dk
7.  4 +2W1G Rf5g5
8.  10 +1G +1:1G Pk XC3x3  ; C2 was still blocked, so the 10 paid less than it looks
9.  8 +4:1W Cf3            ; the ore is under the robber, so upgrade and wait
10. 3 +1L +4:1B
11. 4 +2W1G Tb:4W>1B!

; forty turns of quiet building, elided

53. 9 +2L1G +3:1G Ch5 ^LA #1:10
`
