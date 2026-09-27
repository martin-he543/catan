import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BoardEditor } from '../components/BoardEditor'
import { PositionBoard, type Tool } from '../components/PositionBoard'
import { newGame } from '../lib/board'
import { decodeGame, decodeMoves, encodeGame } from '../lib/codec'
import { NOTATION_REFERENCE, boardToCsn, parseCsn, type Edge } from '../lib/notation'
import {
  KNIGHT_SUPPLY,
  MAX_SEATS,
  MIN_SEATS,
  PIECE_SUPPLY,
  VICTORY_CARD_SUPPLY,
  WINNING_POINTS,
  clearEdge,
  clearVertex,
  emptySeat,
  formatPosition,
  parsePosition,
  placeBuilding,
  positionFromUrl,
  positionProblems,
  positionToUrl,
  robberFromLabel,
  robberLabel,
  standings,
  toggleRoad,
  type Award,
  type SeatPieces,
  type SeatScore,
} from '../lib/position'
import { blankBoard, boardProblems } from '../lib/vision'
import { PLACEMENT_ORDER, PLAYER_COLORS, type PortType, type Tile } from '../lib/types'

interface State {
  tiles: Tile[]
  ports: PortType[]
  /** Per-port shoreline nudges; missing is the standard layout. */
  portShifts?: number[]
  robber: number
  /** Blank means "use the seat's colour". */
  names: string[]
  seats: SeatPieces[]
}

const COLOR_NAMES = PLAYER_COLORS.map((c) => c[0].toUpperCase() + c.slice(1))

const desertOf = (tiles: readonly Tile[]) => Math.max(0, tiles.findIndex((t) => t.type === 'desert' && !t.blank))

/** Names go into notation and URLs, so keep to characters that survive both. */
const cleanName = (name: string) => name.replace(/[\s./_:"^\\]+/g, '').slice(0, 16)

function resize<T>(list: readonly T[], length: number, make: () => T): T[] {
  return Array.from({ length }, (_, i) => list[i] ?? make())
}

/**
 * Rebuild a position from URL parameters. Board generator links work too —
 * their opening settlements are dealt out to seats in snake order.
 */
function fromParams(params: URLSearchParams): State | null {
  const code = params.get('b') ?? params.get('game')
  const game = code ? decodeGame(code) : null
  if (!game && !params.has('p')) return null

  const { tiles, ports, portShifts } = game ?? newGame('spiral')
  let seats = params.has('p') ? parsePosition(positionFromUrl(params.get('p')!)) : []

  if (!params.has('p') && params.has('moves')) {
    seats = PLAYER_COLORS.map(emptySeat)
    decodeMoves(params.get('moves')!).forEach((vertex, i) => {
      seats = placeBuilding(seats, PLAYER_COLORS.indexOf(PLACEMENT_ORDER[i]), vertex, 'settlement')
    })
  }

  const count = Math.min(MAX_SEATS, Math.max(MIN_SEATS, seats.length || MAX_SEATS))
  const robber = params.has('r') ? robberFromLabel(params.get('r')!) : -1
  return {
    tiles,
    ports,
    portShifts,
    robber: robber >= 0 ? robber : desertOf(tiles),
    names: resize((params.get('n') ?? '').split('.').map(cleanName), count, () => ''),
    seats: resize(seats, count, emptySeat),
  }
}

function freshState(): State {
  const { tiles, ports } = newGame('spiral')
  return { tiles, ports, robber: desertOf(tiles), names: ['', '', '', ''], seats: PLAYER_COLORS.map(emptySeat) }
}

function toParams(state: State): URLSearchParams {
  const params = new URLSearchParams()
  params.set('b', encodeGame({ tiles: state.tiles, ports: state.ports, portShifts: state.portShifts, locs: [] }))
  params.set('p', positionToUrl(formatPosition(state.seats)))
  if (state.names.some(Boolean)) params.set('n', state.names.join('.'))
  if (state.robber !== desertOf(state.tiles)) params.set('r', robberLabel(state.robber))
  return params
}

function toCsn(state: State, names: string[]): string {
  const players = names.map((n, i) => `${i + 1}:${n}`).join(' ')
  const header = boardToCsn({ tiles: state.tiles, ports: state.ports, portShifts: state.portShifts, locs: [] }, { Players: players })
  return `${header}\n[Robber "${robberLabel(state.robber)}"]\n[Position "${formatPosition(state.seats)}"]`
}

/** Read pasted notation, a share link from this page, or a board generator link. */
function fromText(text: string): { state: State | null; message: string } {
  const trimmed = text.trim()
  if (/^https?:\/\/|^\?|^\/\S*\?/.test(trimmed)) {
    try {
      const state = fromParams(new URL(trimmed, window.location.href).searchParams)
      return state
        ? { state, message: 'Loaded the position from that link.' }
        : { state: null, message: 'That link has no board in it.' }
    } catch {
      return { state: null, message: 'That link could not be read.' }
    }
  }

  const parsed = parseCsn(trimmed)
  if (!parsed.tiles) {
    return { state: null, message: parsed.issues[0]?.message ?? 'No [Board] tag in that notation.' }
  }
  const issues = [...parsed.issues]
  const seats = parsed.tags.Position ? parsePosition(parsed.tags.Position, issues) : []
  const count = Math.min(MAX_SEATS, Math.max(MIN_SEATS, parsed.tags.Players ? parsed.players.length : seats.length || MAX_SEATS))
  const robber = parsed.tags.Robber ? robberFromLabel(parsed.tags.Robber) : -1
  const names = parsed.tags.Players ? parsed.players.map((p) => cleanName(p.name)) : []
  const state: State = {
    tiles: parsed.tiles,
    ports: parsed.ports ?? freshState().ports,
    portShifts: parsed.portShifts ?? undefined,
    robber: robber >= 0 ? robber : desertOf(parsed.tiles),
    // A name that is just the seat's colour reads better left blank.
    names: resize(names, count, () => '').map((n, i) => (n === COLOR_NAMES[i] ? '' : n)),
    seats: resize(seats, count, emptySeat),
  }
  return {
    state,
    message:
      issues.length === 0
        ? 'Loaded the position from that notation.'
        : `Loaded, but skipped what it could not read: ${issues[0].message}${issues.length > 1 ? ` (and ${issues.length - 1} more)` : ''}.`,
  }
}

const TOOLS: Array<{ tool: Tool; label: string; key: string }> = [
  { tool: 'settlement', label: 'Settlement', key: 'S' },
  { tool: 'city', label: 'City', key: 'C' },
  { tool: 'road', label: 'Road', key: 'R' },
  { tool: 'robber', label: 'Robber', key: 'X' },
  { tool: 'erase', label: 'Erase', key: 'E' },
]

const SWATCH: Record<(typeof PLAYER_COLORS)[number], string> = {
  red: 'bg-player-red',
  blue: 'bg-player-blue',
  yellow: 'bg-player-yellow',
  white: 'bg-player-white',
}

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-xs">{children}</kbd>
)

function Stepper({
  label, value, max, onChange,
}: { label: string; value: number; max: number; onChange: (n: number) => void }) {
  const button = 'h-7 w-7 rounded-lg bg-white/10 text-sm transition hover:bg-white/20 disabled:opacity-30'
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className={button} disabled={value <= 0}
        onClick={() => onChange(value - 1)} aria-label={`One fewer ${label}`}>
        −
      </button>
      <span className="w-5 text-center font-display font-semibold tabular-nums" aria-label={`${value} ${label}`}>
        {value}
      </span>
      <button type="button" className={button} disabled={value >= max}
        onClick={() => onChange(value + 1)} aria-label={`One more ${label}`}>
        +
      </button>
    </div>
  )
}

/** Played knights, laid face up in front of the player as they would be at the table. */
function KnightCards({ count }: { count: number }) {
  if (count === 0) return <span className="text-xs text-sea-200/50">none played</span>
  return (
    <div className="flex" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="-ml-2.5 flex h-8 w-6 items-center justify-center rounded-[4px] border
                     border-amber-900/60 bg-gradient-to-b from-amber-200 to-amber-400 text-xl
                     leading-none text-amber-950 shadow-[0_1px_3px_rgba(0,0,0,0.5)] first:ml-0"
        >
          ♞
        </span>
      ))}
    </div>
  )
}

function Tally({ label, used, total }: { label: string; used: number; total: number }) {
  return (
    <div className={`rounded-lg px-2 py-1.5 ${used > total ? 'bg-red-500/20 text-red-100' : 'bg-white/5'}`}>
      <div className="text-[0.65rem] tracking-wide text-sea-200 uppercase">{label}</div>
      <div className="font-display font-semibold tabular-nums">
        {used}
        <span className="text-sea-200/50">/{total}</span>
      </div>
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[0.7rem] font-semibold text-amber-950">
      {children}
    </span>
  )
}

function SeatCard({
  index, name, placeholder, seat, score, active, onActivate, onName, onSeat,
}: {
  index: number
  name: string
  placeholder: string
  seat: SeatPieces
  score: SeatScore
  active: boolean
  onActivate: () => void
  onName: (name: string) => void
  onSeat: (seat: SeatPieces) => void
}) {
  const color = PLAYER_COLORS[index]
  const won = score.points >= WINNING_POINTS
  return (
    <section
      onClick={onActivate}
      className={`panel flex flex-col gap-3 p-4 transition ${active ? 'ring-2 ring-sea-400' : 'hover:bg-white/10'}`}
      aria-label={`${name || placeholder}, ${score.points} victory points`}
    >
      <div className="flex items-center gap-3">
        <span className={`h-4 w-4 shrink-0 rounded-[4px] border border-black/40 ${SWATCH[color]}`} aria-hidden />
        <input
          value={name}
          placeholder={placeholder}
          onChange={(e) => onName(cleanName(e.target.value))}
          onFocus={onActivate}
          aria-label={`Seat ${index + 1} name`}
          className="min-w-0 flex-1 rounded-lg bg-transparent px-1 py-0.5 font-display font-semibold
                     placeholder:text-sea-50 hover:bg-white/5 focus:bg-black/30"
        />
        <div className="text-right">
          <div className="font-display text-2xl leading-none font-bold tabular-nums">
            {score.points}
            <span className="ml-1 text-xs font-semibold text-sea-200">VP</span>
          </div>
          {seat.victoryCards > 0 && (
            <div className="mt-1 text-[0.7rem] text-sea-200">{score.publicPoints} showing</div>
          )}
        </div>
      </div>

      {(won || score.longestRoad || score.largestArmy) && (
        <div className="flex flex-wrap gap-1.5">
          {won && <Badge>Wins with {score.points}</Badge>}
          {score.longestRoad && <Badge>Longest Road +2</Badge>}
          {score.largestArmy && <Badge>Largest Army +2</Badge>}
        </div>
      )}

      <div className="grid grid-cols-4 gap-1.5 text-center">
        <Tally label="Settle." used={seat.settlements.length} total={PIECE_SUPPLY.settlements} />
        <Tally label="Cities" used={seat.cities.length} total={PIECE_SUPPLY.cities} />
        <Tally label="Roads" used={seat.roads.length} total={PIECE_SUPPLY.roads} />
        <div className="rounded-lg bg-white/5 px-2 py-1.5">
          <div className="text-[0.65rem] tracking-wide text-sea-200 uppercase">Longest</div>
          <div className="font-display font-semibold tabular-nums">{score.roadLength}</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs text-sea-200">Knights played</span>
          <KnightCards count={seat.knights} />
        </div>
        <Stepper label="knights" value={seat.knights} max={KNIGHT_SUPPLY}
          onChange={(knights) => onSeat({ ...seat, knights })} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-sea-200">Victory point cards</span>
        <Stepper label="victory point cards" value={seat.victoryCards} max={VICTORY_CARD_SUPPLY}
          onChange={(victoryCards) => onSeat({ ...seat, victoryCards })} />
      </div>
    </section>
  )
}

function TieNotice({
  award, tied, names, onClaim,
}: { award: Award; tied: number[]; names: string[]; onClaim: (seat: number) => void }) {
  if (tied.length === 0) return null
  const what = award === 'LR' ? 'longest road' : 'largest army'
  return (
    <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm">
      <p className="text-amber-100">
        {tied.map((i) => names[i]).join(' and ')} are level on the {what}. The first to get there
        keeps it — who was that?
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {tied.map((i) => (
          <button key={i} type="button" onClick={() => onClaim(i)}
            className="rounded-lg bg-white/10 px-3 py-1 font-semibold transition hover:bg-white/20">
            {names[i]}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Position() {
  const [params, setParams] = useSearchParams()
  const [{ state, past }, setHistory] = useState<{ state: State; past: State[] }>(() => ({
    state: fromParams(params) ?? freshState(),
    past: [],
  }))
  const [mode, setMode] = useState<'layout' | 'pieces'>(() =>
    ['b', 'p', 'game'].some((k) => params.has(k)) ? 'pieces' : 'layout',
  )
  const [tool, setTool] = useState<Tool>('settlement')
  const [active, setActive] = useState(0)
  const [selectedTile, setSelectedTile] = useState<number | null>(null)
  const [pasted, setPasted] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [copied, setCopied] = useState<'link' | 'csn' | null>(null)

  const commit = useCallback((update: (s: State) => State) => {
    setHistory((h) => {
      const next = update(h.state)
      return next === h.state ? h : { state: next, past: [...h.past.slice(-99), h.state] }
    })
  }, [])

  const undo = useCallback(() => {
    setHistory((h) =>
      h.past.length === 0 ? h : { state: h.past[h.past.length - 1], past: h.past.slice(0, -1) },
    )
  }, [])

  // The address bar always holds the current position, so it can be bookmarked as is.
  const query = useMemo(() => toParams(state).toString(), [state])
  useEffect(() => {
    setParams(new URLSearchParams(query), { replace: true })
  }, [query, setParams])

  const count = state.seats.length
  const seatActive = Math.min(active, count - 1)
  const names = state.names.map((n, i) => n || COLOR_NAMES[i])
  const colors = PLAYER_COLORS.slice(0, count)
  const { scores, roadTie, armyTie } = useMemo(() => standings(state.seats), [state.seats])
  const problems = [...boardProblems(state.tiles), ...positionProblems(state.seats, names)]

  const setSeats = useCallback(
    (update: (seats: SeatPieces[]) => SeatPieces[]) => commit((s) => ({ ...s, seats: update(s.seats) })),
    [commit],
  )

  const onVertex = useCallback(
    (vertex: number) => {
      if (tool === 'erase') setSeats((seats) => clearVertex(seats, vertex))
      else if (tool === 'settlement' || tool === 'city') {
        setSeats((seats) => placeBuilding(seats, seatActive, vertex, tool))
      }
    },
    [tool, seatActive, setSeats],
  )

  const onEdge = useCallback(
    (edge: Edge) =>
      setSeats((seats) => (tool === 'erase' ? clearEdge(seats, edge) : toggleRoad(seats, seatActive, edge))),
    [tool, seatActive, setSeats],
  )

  const claim = useCallback(
    (award: Award, seat: number) =>
      setSeats((seats) =>
        seats.map((s, i) => ({
          ...s,
          claims: i === seat ? [...new Set([...s.claims, award])] : s.claims.filter((a) => a !== award),
        })),
      ),
    [setSeats],
  )

  const setCount = useCallback(
    (n: number) =>
      commit((s) => ({
        ...s,
        seats: resize(s.seats, n, emptySeat),
        names: resize(s.names, n, () => ''),
      })),
    [commit],
  )

  // Shortcuts for the pieces step; the layout step has its own in BoardEditor.
  useEffect(() => {
    if (mode !== 'pieces') return
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable]')) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key.toLowerCase()
      const pick = TOOLS.find((t) => t.key.toLowerCase() === key)
      if (pick) setTool(pick.tool)
      else if (key === 'u') undo()
      else if (/^[1-4]$/.test(key) && Number(key) <= count) setActive(Number(key) - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, count, undo])

  const shareUrl = `${window.location.origin}${window.location.pathname}?${query}`
  const csn = toCsn(state, names)

  const copy = useCallback(async (what: 'link' | 'csn', text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(what)
    setTimeout(() => setCopied(null), 1500)
  }, [])

  const load = useCallback(() => {
    const result = fromText(pasted)
    if (result.state) {
      const loaded = result.state
      commit(() => loaded)
      setMode('pieces')
    }
    setStatus(result.message)
  }, [pasted, commit])

  const segment = (on: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm transition ${on ? 'bg-sea-400 font-semibold text-sea-950' : 'hover:bg-white/10'}`

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 lg:px-8">
      <header>
        <p className="font-display text-sm tracking-[0.2em] text-sea-200 uppercase">Position</p>
        <h1 className="mt-2 font-display text-4xl font-bold sm:text-5xl">Save a game in progress</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-sea-100/80">
          Lay out the board, put down everyone's settlements, cities and roads, and record the
          knights they have played. The score keeps itself — longest road and largest army
          included — and the whole position fits in one link.
        </p>
      </header>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="panel flex gap-1 p-1" role="tablist" aria-label="What to edit">
              <button type="button" role="tab" aria-selected={mode === 'layout'}
                className={segment(mode === 'layout')} onClick={() => setMode('layout')}>
                1 · Tiles and ports
              </button>
              <button type="button" role="tab" aria-selected={mode === 'pieces'}
                className={segment(mode === 'pieces')} onClick={() => setMode('pieces')}>
                2 · Pieces
              </button>
            </div>
            <button type="button" onClick={undo} disabled={past.length === 0}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-sm transition
                         hover:bg-white/10 disabled:opacity-40">
              Undo
            </button>
          </div>

          {mode === 'layout' ? (
            <>
              <div className="flex flex-wrap gap-2">
                <button type="button"
                  onClick={() => commit((s) => { const g = newGame('pseudorandom'); return { ...s, ...g, robber: desertOf(g.tiles) } })}
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-sm transition hover:bg-white/20">
                  Random board
                </button>
                <button type="button"
                  onClick={() => commit((s) => { const tiles = blankBoard(); return { ...s, tiles, robber: desertOf(tiles) } })}
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-sm transition hover:bg-white/20">
                  Blank board
                </button>
              </div>
              <p className="text-sm text-sea-100/70">
                Click a tile to set its terrain and number, or type them — 2 to 9 land straight
                away, and 1 waits for the 0, 1 or 2 that follows. Click a port to cycle it,
                and use Left or Right if your board's harbours all sit one edge along.
              </p>
              <BoardEditor
                tiles={state.tiles}
                ports={state.ports}
                portShifts={state.portShifts}
                guesses={null}
                selected={selectedTile}
                onSelect={setSelectedTile}
                onTile={(i, tile) =>
                  commit((s) => ({ ...s, tiles: s.tiles.map((t, at) => (at === i ? tile : t)) }))
                }
                onPort={(i, port) =>
                  commit((s) => ({ ...s, ports: s.ports.map((p, at) => (at === i ? port : p)) }))
                }
                onShiftPorts={(portShifts) => commit((s) => ({ ...s, portShifts }))}
              />
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div className="panel flex gap-1 p-1" role="radiogroup" aria-label="Whose pieces">
                  {names.map((name, i) => (
                    <button key={i} type="button" role="radio" aria-checked={seatActive === i}
                      onClick={() => setActive(i)} title={`Key ${i + 1}`}
                      className={`flex items-center gap-2 ${segment(seatActive === i)}`}>
                      <span className={`h-3 w-3 rounded-[3px] border border-black/40 ${SWATCH[PLAYER_COLORS[i]]}`} aria-hidden />
                      {name}
                    </button>
                  ))}
                </div>
                <div className="panel flex flex-wrap gap-1 p-1" role="radiogroup" aria-label="Tool">
                  {TOOLS.map((t) => (
                    <button key={t.tool} type="button" role="radio" aria-checked={tool === t.tool}
                      onClick={() => setTool(t.tool)} title={`Key ${t.key}`} className={segment(tool === t.tool)}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <PositionBoard
                tiles={state.tiles}
                ports={state.ports}
                portShifts={state.portShifts}
                seats={state.seats}
                colors={colors}
                names={names}
                robber={state.robber}
                tool={tool}
                active={seatActive}
                onVertex={onVertex}
                onEdge={onEdge}
                onHex={(hex) => commit((s) => (s.robber === hex ? s : { ...s, robber: hex }))}
              />
              <p className="text-sm text-sea-100/60">
                Click your own piece again to step it back: a city becomes a settlement, a
                settlement or road is picked up. Placing on someone else's spot takes it over.
                Keys: <Kbd>1</Kbd>–<Kbd>{count}</Kbd> pick a player, <Kbd>S</Kbd> <Kbd>C</Kbd>{' '}
                <Kbd>R</Kbd> <Kbd>X</Kbd> <Kbd>E</Kbd> pick a tool, <Kbd>U</Kbd> undoes.
              </p>
            </>
          )}

          {problems.length > 0 && (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3">
              <p className="font-display font-semibold text-amber-100">Worth a second look</p>
              <ul className="mt-2 list-inside list-disc text-sm text-amber-100/80">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <aside className="flex w-full flex-col gap-4 lg:w-96 lg:shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold">Scores</h2>
            <div className="panel flex gap-1 p-1" role="radiogroup" aria-label="Number of players">
              {[2, 3, 4].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={count === n}
                  onClick={() => setCount(n)} className={segment(count === n)}
                  aria-label={`${n} players`}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <TieNotice award="LR" tied={roadTie} names={names} onClaim={(i) => claim('LR', i)} />
          <TieNotice award="LA" tied={armyTie} names={names} onClaim={(i) => claim('LA', i)} />

          {state.seats.map((seat, i) => (
            <SeatCard
              key={i}
              index={i}
              name={state.names[i]}
              placeholder={COLOR_NAMES[i]}
              seat={seat}
              score={scores[i]}
              active={mode === 'pieces' && seatActive === i}
              onActivate={() => setActive(i)}
              onName={(name) => commit((s) => ({ ...s, names: s.names.map((n, at) => (at === i ? name : n)) }))}
              onSeat={(next) => setSeats((seats) => seats.map((s, at) => (at === i ? next : s)))}
            />
          ))}

          <section className="panel flex flex-col gap-3 p-4">
            <h2 className="font-display text-lg font-bold">Share</h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => copy('link', shareUrl)}
                className="rounded-xl bg-sea-400 px-4 py-2 font-display font-semibold text-sea-950
                           transition hover:brightness-110">
                {copied === 'link' ? 'Copied' : 'Copy link'}
              </button>
              <button type="button" onClick={() => copy('csn', csn)}
                className="rounded-xl border border-white/15 px-4 py-2 font-display font-semibold
                           transition hover:bg-white/10">
                {copied === 'csn' ? 'Copied' : 'Copy notation'}
              </button>
            </div>
            <pre className="max-h-60 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3
                            font-mono text-[0.7rem] leading-relaxed whitespace-pre-wrap break-all text-sea-100">
              {csn}
            </pre>

            <details>
              <summary className="cursor-pointer text-sm font-semibold">
                Load a link or notation
              </summary>
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={4}
                spellCheck={false}
                placeholder={'A link from this page or the board generator, or\n[Board "…"]\n[Position "Sf3 Rf3g3 / …"]'}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 p-3
                           font-mono text-xs text-sea-100 placeholder:text-sea-200/40"
              />
              <button type="button" onClick={load}
                className="mt-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold
                           transition hover:bg-white/10">
                Load it
              </button>
              {status && <p role="status" className="mt-2 text-sm text-sea-100">{status}</p>}
            </details>

            <details>
              <summary className="cursor-pointer text-sm font-semibold">How the notation works</summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                {NOTATION_REFERENCE.find((s) => s.title === 'Positions')!.rows.map((row) => (
                  <div key={row.token} className="contents">
                    <dt className="font-mono text-sea-50">{row.token}</dt>
                    <dd className="text-sea-100/70">{row.meaning}</dd>
                  </div>
                ))}
                <dt className="font-mono text-sea-50">Sf3 Cf3 Rf3g3</dt>
                <dd className="text-sea-100/70">
                  Settlement, city and road, on the same corner and edge names a game record uses.
                </dd>
              </dl>
            </details>
          </section>
        </aside>
      </div>
    </div>
  )
}
