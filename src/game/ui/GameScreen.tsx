/**
 * A game in progress, from one seat's point of view. It knows nothing about
 * where the game lives: it is handed a redacted view and an `act` function,
 * so local games, direct Firestore games and Cloud Function games all share
 * it.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { asset } from '../../lib/assets'
import { canImprove, canPromote, improvementCost, knightCanAct, knightMoves } from '../engine/ck'
import { FISH_COSTS, FISH_LABELS } from '../engine/fish'
import {
  legalCities,
  legalKnights,
  legalRoutes,
  legalSettlements,
  shipCanMove,
  canPlaceRoute,
} from '../engine/placement'
import { actingSeat, waitingOn } from '../engine/rules'
import { COSTS, TRACK_COMMODITY, activePrompts, hasCards, supplyLeft, topo, totalPoints } from '../engine/state'
import type { GameView } from '../engine/view'
import {
  RuleError,
  TRACKS,
  type Action,
  type CardCounts,
  type FishUse,
  type ProgressCardType,
  type Prompt,
  type RouteKind,
} from '../engine/types'
import { CardList, DiceView } from './cards'
import { GameBoard, type Ghost, type Targets } from './GameBoard'
import { PLAYER_HEX, TRACK_COLOR, TRACK_LABEL } from './labels'
import { BankPanel, BarbarianTrack, HandPanel, ImprovementsHelp, LogList, Panel, PlayersPanel, Standings, Swatch } from './panels'
import { asState } from './util'
import { PromptPanel, WaitingOn } from './PromptPanel'
import { TradePanel } from './TradePanel'

type Tool =
  | 'road' | 'ship' | 'settlement' | 'city' | 'wall' | 'knight'
  | 'activate' | 'promote' | 'moveKnight' | 'chase' | 'moveShip'

export interface GameScreenProps {
  view: GameView
  /** The seat playing from this screen, or null to watch. */
  seat: number | null
  act: (action: Action) => Promise<void>
  header?: ReactNode
  /** Extra panels for the sidebar, like chat. */
  side?: ReactNode
  /** Where the replay of this game lives, once it is over. */
  replayHref?: string
}

/** Seconds left on the turn timer, ticking. */
function Countdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const left = Math.max(0, Math.ceil((deadline - now) / 1000))
  return (
    <span className={`rounded-md px-2 py-0.5 font-display text-sm font-semibold tabular-nums ${left <= 10 ? 'bg-rose-500/30 text-rose-100' : 'bg-white/10'}`}
      title="Time left before the autopilot steps in">
      ⏱ {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
    </span>
  )
}

const MUTE_KEY = 'catan.mute'

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

/** The board generator's dice sound, whenever anyone rolls. */
function useRollSound(view: GameView, muted: boolean) {
  const rolledAt = view.turn.rolled && view.turn.dice ? `${view.turn.number}:${view.turn.dice.a}${view.turn.dice.b}` : null
  useEffect(() => {
    if (!rolledAt || muted) return
    const audio = new Audio(asset('audio/dice_roll.mp3'))
    audio.volume = 0.5
    // Browsers refuse sound before the first click; that's fine.
    audio.play().catch(() => {})
  }, [rolledAt, muted])
}

/** The cheapest set of fish tokens that covers a cost. */
function tokensFor(fish: number[], cost: number): number[] | null {
  let best: number[] | null = null
  let bestSum = Infinity
  for (let mask = 1; mask < 1 << fish.length; mask++) {
    let sum = 0
    const picked: number[] = []
    fish.forEach((f, i) => {
      if (mask & (1 << i)) {
        sum += f
        picked.push(i)
      }
    })
    if (sum >= cost && (sum < bestSum || (sum === bestSum && picked.length < best!.length))) {
      best = picked
      bestSum = sum
    }
  }
  return best
}

export function GameScreen({ view, seat, act, header, side, replayHref }: GameScreenProps) {
  const state = asState(view)
  // Tools and picks belong to one moment of the game: a new turn, or a new
  // question, starts them afresh.
  const turnKey = `${view.phase}:${view.turn.number}:${view.turn.seat}:${view.turn.stage.kind}`
  const [toolState, setToolState] = useState<{ key: string; tool: Tool | null; from: number | null }>({ key: '', tool: null, from: null })
  const tool = toolState.key === turnKey ? toolState.tool : null
  const from = toolState.key === turnKey ? toolState.from : null
  const setTool = (next: Tool | null | ((t: Tool | null) => Tool | null)) =>
    setToolState((s) => {
      const current = s.key === turnKey ? s.tool : null
      return { key: turnKey, tool: typeof next === 'function' ? next(current) : next, from: null }
    })
  const setFrom = (v: number | null) => setToolState((s) => ({ key: turnKey, tool: s.key === turnKey ? s.tool : null, from: v }))
  const [pickState, setPickState] = useState<{ id: string; hexes: number[] }>({ id: '', hexes: [] })
  const [routeKind, setRouteKind] = useState<RouteKind>('road')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dice, setDice] = useState({ a: 3, b: 4 })
  const [muted, setMuted] = useState(readMuted)
  useRollSound(view, muted)

  const active = activePrompts(state)
  const myPrompt: Prompt | null = seat === null ? null : active.find((p) => p.seat === seat) ?? null
  const otherPrompts = active.filter((p) => p.seat !== seat)
  const actor = actingSeat(state)
  const myMove = seat !== null && actor === seat && !myPrompt
  const waiting = waitingOn(state)
  const me = seat === null ? null : view.players[seat]
  const stage = view.turn.stage.kind
  const ck = view.config.citiesKnights
  const sea = view.config.seafarers

  const picked = pickState.id === myPrompt?.id ? pickState.hexes : []
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 4000)
    return () => clearTimeout(t)
  }, [error])

  const run = async (action: Action) => {
    setBusy(true)
    setError(null)
    try {
      await act(action)
    } catch (e) {
      if ((e as Error).name !== 'StaleError') setError(e instanceof RuleError || e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const respond = (prompt: Prompt, response: Omit<Extract<Action, { type: 'respond' }>, 'type' | 'prompt'>) =>
    run({ type: 'respond', prompt: prompt.id, ...response })

  /* ---- what the board should light up ---- */

  const targets: Targets | null = (() => {
    if (seat === null) return null
    const color = view.players[seat].color
    if (myPrompt?.input.kind === 'board') {
      const input = myPrompt.input
      const edgeGhost = (e: number): RouteKind => {
        const pieces = input.pieces ?? ['road']
        if (pieces.length === 1) return pieces[0]
        const road = canPlaceRoute(state, seat, e, 'road')
        const ship = canPlaceRoute(state, seat, e, 'ship')
        return road && ship ? routeKind : road ? 'road' : 'ship'
      }
      const ghost: Ghost = input.edges ? 'road' : myPrompt.type === 'deserterPlace' ? 'knight' : 'none'
      return { vertices: input.vertices, edges: input.edges, hexes: input.hexes, ghost, color, edgeGhost }
    }
    if (!myMove) return null
    if (view.phase === 'setup' && view.setup) {
      const s = view.setup
      const step = s.steps[s.index]
      if (s.anchor === null) {
        return { vertices: legalSettlements(state, seat, true), ghost: step.building === 'city' ? 'city' : 'settlement', color }
      }
      const roads = legalRoutes(state, seat, 'road', { anchor: s.anchor })
      const ships = sea ? legalRoutes(state, seat, 'ship', { anchor: s.anchor }) : []
      return {
        edges: [...new Set([...roads, ...ships])],
        color,
        ghost: 'road',
        edgeGhost: (e) => (roads.includes(e) && ships.includes(e) ? routeKind : roads.includes(e) ? 'road' : 'ship'),
      }
    }
    switch (tool) {
      case 'road':
        return { edges: legalRoutes(state, seat, 'road'), ghost: 'road', color }
      case 'ship':
        return { edges: legalRoutes(state, seat, 'ship'), ghost: 'ship', color }
      case 'settlement':
        return { vertices: legalSettlements(state, seat), ghost: 'settlement', color }
      case 'city':
        return { vertices: legalCities(state, seat), ghost: 'none', color }
      case 'wall':
        return {
          vertices: view.buildings.flatMap((b, v) => (b?.owner === seat && b.kind === 'city' && !b.wall ? [v] : [])),
          ghost: 'none',
          color,
        }
      case 'knight':
        return { vertices: legalKnights(state, seat), ghost: 'knight', color }
      case 'activate':
        return { vertices: view.knights.flatMap((k, v) => (k?.owner === seat && !k.active ? [v] : [])), ghost: 'none', color }
      case 'promote':
        return { vertices: view.knights.flatMap((k, v) => (k?.owner === seat && !canPromote(state, seat, v) ? [v] : [])), ghost: 'none', color }
      case 'moveKnight':
        if (from === null) {
          return { vertices: view.knights.flatMap((k, v) => (k?.owner === seat && knightMoves(state, seat, v).length ? [v] : [])), ghost: 'none', color }
        }
        return { vertices: knightMoves(state, seat, from), ghost: 'knight', color }
      case 'chase': {
        if (view.robber < 0) return null
        const t = topo(state)
        return {
          vertices: t.hexes[view.robber].corners.filter((v) => view.knights[v]?.owner === seat && !knightCanAct(state, seat, v)),
          ghost: 'none',
          color,
        }
      }
      case 'moveShip': {
        if (from === null) {
          return { edges: view.routes.flatMap((r, e) => (r?.owner === seat && shipCanMove(state, seat, e) ? [e] : [])), ghost: 'none', color }
        }
        const probe = structuredClone(state)
        probe.routes[from] = null
        return { edges: legalRoutes(probe, seat, 'ship').filter((e) => e !== from), ghost: 'ship', color }
      }
      default:
        return null
    }
  })()

  /* ---- board clicks ---- */

  const onVertex = (v: number) => {
    if (seat === null) return
    if (myPrompt?.input.kind === 'board') return respond(myPrompt, { vertex: v })
    if (view.phase === 'setup' && view.setup) {
      const step = view.setup.steps[view.setup.index]
      return run({ type: 'build', piece: step.building, at: v })
    }
    switch (tool) {
      case 'settlement':
      case 'city':
      case 'wall':
      case 'knight':
        setTool(null)
        return run({ type: 'build', piece: tool, at: v })
      case 'activate':
        setTool(null)
        return run({ type: 'activateKnight', at: v })
      case 'promote':
        setTool(null)
        return run({ type: 'promoteKnight', at: v })
      case 'chase':
        setTool(null)
        return run({ type: 'chaseRobber', at: v })
      case 'moveKnight':
        if (from === null) return setFrom(v)
        setTool(null)
        setFrom(null)
        return run({ type: 'moveKnight', from, to: v })
    }
  }

  const onEdge = (e: number) => {
    if (seat === null) return
    if (myPrompt?.input.kind === 'board') {
      const kind = targets?.edgeGhost?.(e) ?? 'road'
      return respond(myPrompt, { edge: e, piece: kind })
    }
    if (view.phase === 'setup') return run({ type: 'build', piece: targets?.edgeGhost?.(e) ?? 'road', at: e })
    if (tool === 'road' || tool === 'ship') {
      // Keep the tool for the next piece if it is still affordable.
      if (!hasCards(me!.hand, { brick: 2, lumber: 2 }) && tool === 'road') setTool(null)
      if (tool === 'ship' && !hasCards(me!.hand, { lumber: 2, sheep: 2 })) setTool(null)
      return run({ type: 'build', piece: tool, at: e })
    }
    if (tool === 'moveShip') {
      if (from === null) return setFrom(e)
      setTool(null)
      setFrom(null)
      return run({ type: 'moveShip', from, to: e })
    }
  }

  const onHex = (h: number) => {
    if (!myPrompt || myPrompt.input.kind !== 'board') return
    const count = myPrompt.input.count ?? 1
    if (count > 1) {
      const next = picked.includes(h) ? picked.filter((x) => x !== h) : [...picked, h].slice(-count)
      setPickState({ id: myPrompt.id, hexes: next })
      return
    }
    return respond(myPrompt, { hex: h })
  }

  /* ---- keyboard: R rolls, E ends the turn, Esc drops the tool ---- */

  const canRoll = myMove && view.phase === 'main' && stage === 'main' && !view.turn.rolled
  const canEnd = myMove && view.phase === 'main' && (stage !== 'main' || view.turn.rolled)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey || target?.closest('input, textarea, select, [contenteditable]')) return
      const key = e.key.toLowerCase()
      if (key === 'escape') setToolState({ key: '', tool: null, from: null })
      else if (key === 'r' && canRoll && !busy) void run({ type: 'roll' })
      else if (key === 'e' && canEnd && !busy) void run({ type: 'endTurn' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---- status line ---- */

  const actorName = actor !== null ? view.players[actor].name : null
  const status = (() => {
    if (view.phase === 'ended') return `${view.players[view.winner!].name} wins — ${view.endReason ?? ''}`
    if (view.phase === 'setup' && view.setup) {
      const step = view.setup.steps[view.setup.index]
      const what = view.setup.anchor === null ? `a ${step.building}` : sea ? 'a road or ship' : 'a road'
      return actor === seat ? `Place ${what}` : `${actorName} is placing ${what}`
    }
    if (active.length) {
      return myPrompt ? myPrompt.text : `Waiting for ${[...new Set(active.map((p) => view.players[p.seat].name))].join(', ')}`
    }
    const who = actor === seat ? 'Your' : `${actorName}'s`
    if (stage === 'specialBuild') return `${who} special build phase — build only`
    if (stage === 'secondSettler') return `${who} second-settler turn — build and trade with the bank`
    return view.turn.rolled ? `${who} turn` : actor === seat ? 'Your turn — roll the dice' : `${actorName} is about to roll`
  })()

  /* ---- actions ---- */

  const canAct = myMove && view.phase === 'main'
  const rolledOrSpecial = stage !== 'main' || view.turn.rolled
  const playPhase = canAct && stage !== 'specialBuild'

  const playableDev = (card: string) =>
    !!me && canAct && stage !== 'specialBuild' && !ck && !view.turn.devPlayed &&
    me.dev.some((d) => d.type === card && d.bought < view.turn.number)

  const playableProgress = (card: ProgressCardType) =>
    !!me && canAct && stage !== 'specialBuild' && (card === 'alchemist' ? !view.turn.rolled && stage === 'main' : view.turn.rolled || stage === 'secondSettler')

  const toolButton = (key: Tool, label: string, cost: CardCounts | null, enabled: boolean, title?: string) => (
    <button
      key={key}
      type="button"
      disabled={!enabled || busy}
      aria-pressed={tool === key}
      title={title}
      onClick={() => {
        setFrom(null)
        setTool((t) => (t === key ? null : key))
      }}
      className={`flex flex-col items-start gap-1 rounded-xl border px-2.5 py-2 text-left text-sm transition disabled:opacity-35 ${
        tool === key ? 'border-sea-400 bg-sea-400/20' : 'border-white/10 bg-white/5 hover:bg-white/10'
      }`}
    >
      <span className="font-semibold">{label}</span>
      {cost && <CardList cards={cost} empty="free" />}
    </button>
  )

  const left = seat !== null ? supplyLeft(state, seat) : null
  const affordable = (cost: CardCounts) => !!me && hasCards(me.hand, cost)

  const actions = seat === null || view.phase !== 'main' ? null : (
    <Panel title="Your move" right={<DiceView dice={view.turn.dice} ck={ck} />}>
      {!canAct && (
        <p className="text-sm text-sea-100/70">
          {myPrompt ? 'Answer the question above.' : `Waiting for ${actorName ?? 'the others'}.`}
        </p>
      )}

      {canAct && stage === 'main' && !view.turn.rolled && (
        <div className="flex flex-col gap-3">
          <button type="button" disabled={busy} onClick={() => run({ type: 'roll' })} title="Key R"
            className="rounded-xl bg-sea-400 px-5 py-3 font-display text-lg font-bold text-sea-950 transition hover:brightness-110 disabled:opacity-50">
            🎲 Roll the dice
          </button>
          {ck && me!.progress.some((c) => c.type === 'alchemist') && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white/5 p-2 text-sm">
              <span className="font-semibold">Alchemist:</span>
              {(['a', 'b'] as const).map((d) => (
                <label key={d} className="flex items-center gap-1">
                  {d === 'a' ? 'Yellow' : 'Red'}
                  <select value={dice[d]} onChange={(e) => setDice((x) => ({ ...x, [d]: Number(e.target.value) }))}
                    className="rounded-md bg-black/40 px-1 py-0.5">
                    {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              ))}
              <button type="button" disabled={busy} onClick={() => run({ type: 'playProgress', card: 'alchemist', ...dice })}
                className="rounded-lg bg-white/15 px-2.5 py-1 font-semibold hover:bg-white/25">
                Set the dice
              </button>
            </div>
          )}
        </div>
      )}

      {canAct && rolledOrSpecial && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {toolButton('road', 'Road', COSTS.road, affordable(COSTS.road) && left!.road > 0)}
            {toolButton('settlement', 'Settlement', COSTS.settlement, affordable(COSTS.settlement) && left!.settlement > 0)}
            {toolButton('city', 'City', COSTS.city, affordable(COSTS.city) && left!.city > 0)}
            {sea && toolButton('ship', 'Ship', COSTS.ship, affordable(COSTS.ship) && left!.ship > 0)}
            {sea && stage !== 'specialBuild' && toolButton('moveShip', from === null ? 'Move ship' : 'Sail to…', null, !view.turn.shipMoved,
              'Move a ship at the open end of a line, once a turn')}
            {!ck && (
              <button type="button" disabled={busy || !affordable(COSTS.dev) || view.decks.dev === 0}
                onClick={() => run({ type: 'buyDev' })}
                className="flex flex-col items-start gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 text-left text-sm transition hover:bg-white/10 disabled:opacity-35">
                <span className="font-semibold">Development card</span>
                <CardList cards={COSTS.dev} />
              </button>
            )}
            {ck && toolButton('wall', 'City wall', COSTS.wall, affordable(COSTS.wall) && left!.wall > 0)}
            {ck && toolButton('knight', 'Knight', COSTS.knight, affordable(COSTS.knight) && left!.knight[1] > 0)}
            {ck && toolButton('activate', 'Activate', COSTS.activate, affordable(COSTS.activate) && view.knights.some((k) => k?.owner === seat && !k.active))}
            {ck && toolButton('promote', 'Promote', COSTS.promote, affordable(COSTS.promote) && view.knights.some((k, v) => k?.owner === seat && !canPromote(state, seat, v)))}
            {ck && toolButton('moveKnight', from === null ? 'Move knight' : 'Move to…', null, view.knights.some((k, v) => k?.owner === seat && knightMoves(state, seat, v).length > 0))}
            {ck && (view.barbarian?.attacks ?? 0) > 0 && toolButton('chase', 'Chase robber', null, true)}
          </div>

          {ck && (
            <div>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-sea-200 uppercase">City improvements</h3>
              <div className="grid grid-cols-3 gap-2">
                {TRACKS.map((t) => {
                  const level = me!.improvements[t]
                  const problem = canImprove(state, seat, t)
                  return (
                    <button key={t} type="button" disabled={busy || !!problem} title={problem ?? undefined}
                      onClick={() => run({ type: 'improve', track: t })}
                      className="flex flex-col items-start gap-1 rounded-xl border px-2 py-2 text-left text-sm disabled:opacity-40"
                      style={{ borderColor: `${TRACK_COLOR[t]}80`, backgroundColor: `${TRACK_COLOR[t]}1f` }}>
                      <span className="font-semibold">{TRACK_LABEL[t]} {level}→{Math.min(5, level + 1)}</span>
                      {level < 5 && <CardList cards={{ [TRACK_COMMODITY[t]]: improvementCost(state, seat, t) }} />}
                    </button>
                  )
                })}
              </div>
              <details className="text-xs">
                <summary className="mt-2 cursor-pointer text-sea-200">What the improvements do</summary>
                <ImprovementsHelp />
              </details>
            </div>
          )}

          {tool && (
            <p className="text-sm text-sea-100/80">
              {targets && (targets.vertices?.length || targets.edges?.length)
                ? tool === 'moveKnight' && from === null ? 'Pick a knight to move.'
                  : tool === 'moveShip' && from === null ? 'Pick a ship at the open end of a line.'
                  : 'Pick a highlighted spot on the board.'
                : 'Nowhere to put that right now.'}
              <button type="button" onClick={() => { setTool(null); setFrom(null) }} className="ml-2 underline">Cancel</button>
            </p>
          )}

          <button type="button" disabled={busy} onClick={() => run({ type: 'endTurn' })} title="Key E"
            className="rounded-xl bg-sea-400 px-5 py-2.5 font-display font-bold text-sea-950 transition hover:brightness-110 disabled:opacity-50">
            {stage === 'specialBuild' ? 'Done building' : 'End turn'}
          </button>
        </div>
      )}

      {canAct && view.config.fishermen && me!.fish.length > 0 && stage !== 'specialBuild' && (
        <div className="mt-3">
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-sea-200 uppercase">
            Spend fish ({me!.fish.reduce((s, f) => s + f, 0)})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(FISH_COSTS) as FishUse[]).map((use) => {
              const tokens = tokensFor(me!.fish, FISH_COSTS[use])
              return (
                <button key={use} type="button" disabled={busy || !tokens || (use === 'dev' && (ck || view.decks.dev === 0))}
                  onClick={() => tokens && run({ type: 'fish', use, tokens })}
                  className="rounded-lg bg-sky-300/15 px-2.5 py-1 text-xs hover:bg-sky-300/25 disabled:opacity-35">
                  {FISH_LABELS[use]} · {FISH_COSTS[use]}🐟
                </button>
              )
            })}
          </div>
        </div>
      )}

      {canAct && me!.hasBoot && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
          <span>👢 Pass the boot to:</span>
          {view.players.map((p, i) =>
            i !== seat && !p.resigned && totalPoints(state, i) >= totalPoints(state, seat) ? (
              <button key={i} type="button" disabled={busy} onClick={() => run({ type: 'passBoot', to: i })}
                className="rounded-lg bg-white/10 px-2 py-0.5 hover:bg-white/20">
                {p.name}
              </button>
            ) : null,
          )}
        </div>
      )}
    </Panel>
  )

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-3 py-4 sm:px-4 lg:px-6">
      {header}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="panel flex flex-wrap items-center gap-3 px-4 py-2.5">
            {actor !== null && view.phase !== 'ended' && <Swatch color={PLAYER_HEX[view.players[actor].color]} className="h-4 w-4" />}
            <p className="flex-1 font-display font-semibold" aria-live="polite">{status}</p>
            {view.deadline !== null && view.phase !== 'ended' && <Countdown deadline={view.deadline} />}
            <button type="button" aria-pressed={muted} title={muted ? 'Sound off' : 'Sound on'}
              onClick={() => setMuted((m) => {
                try {
                  localStorage.setItem(MUTE_KEY, m ? '0' : '1')
                } catch {
                  // Private mode: the choice lasts this visit.
                }
                return !m
              })}
              className="rounded-md px-1.5 py-0.5 text-sm text-sea-200 hover:bg-white/10">
              {muted ? '🔇' : '🔈'}
            </button>
            <DiceView dice={view.turn.dice} ck={ck} />
          </div>
          {error && (
            <p role="alert" className="rounded-xl border border-rose-400/40 bg-rose-500/15 px-4 py-2 text-sm text-rose-100">{error}</p>
          )}
          {ck && <BarbarianTrack view={view} />}
          <div className="panel overflow-hidden p-2 sm:p-3">
            <GameBoard
              view={view}
              targets={targets}
              onVertex={onVertex}
              onEdge={onEdge}
              onHex={onHex}
              selected={{
                vertices: tool === 'moveKnight' && from !== null ? [from] : undefined,
                edges: tool === 'moveShip' && from !== null ? [from] : undefined,
                hexes: picked,
              }}
            />
          </div>
          <Panel title="Game log" className="hidden xl:block">
            <LogList view={view} />
          </Panel>
        </div>

        <aside className="flex w-full flex-col gap-3 xl:w-[27rem] xl:shrink-0">
          {view.phase === 'ended' && (
            <Panel title="Final scores">
              <Standings view={view} />
              <div className="mt-3 flex flex-wrap gap-2">
                {replayHref && (
                  <Link to={replayHref} className="rounded-xl bg-sea-400 px-4 py-2 font-display font-semibold text-sea-950">
                    Watch the replay
                  </Link>
                )}
                <Link to="/play/new" className="rounded-xl border border-white/15 px-4 py-2 font-display font-semibold hover:bg-white/10">
                  New game
                </Link>
              </div>
            </Panel>
          )}
          {myPrompt && (
            <PromptPanel key={myPrompt.id} view={view} prompt={myPrompt} onRespond={respond} picked={picked}
              routeKind={routeKind} onRouteKind={setRouteKind} busy={busy} />
          )}
          {otherPrompts.length > 0 && (
            <div className="panel p-3">
              <WaitingOn view={view} prompts={otherPrompts} />
            </div>
          )}
          {view.phase === 'setup' && myMove && sea && view.setup?.anchor !== null && (
            <div className="panel flex items-center gap-2 p-3 text-sm">
              <span>Opening piece:</span>
              {(['road', 'ship'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setRouteKind(k)}
                  className={`rounded-lg px-3 py-1 ${routeKind === k ? 'bg-sea-400 font-semibold text-sea-950' : 'bg-white/10'}`}>
                  {k === 'road' ? 'Road' : 'Ship'}
                </button>
              ))}
              <span className="text-xs text-sea-200">for coast edges that take either</span>
            </div>
          )}
          {actions}
          {seat !== null && (
            <HandPanel
              view={view}
              seat={seat}
              canPlayDev={playableDev}
              onPlayDev={(card) => run({ type: 'playDev', card })}
              canPlayProgress={playableProgress}
              onPlayProgress={(card) => run({ type: 'playProgress', card })}
            />
          )}
          {seat !== null && view.phase === 'main' && (playPhase || view.offers.length > 0 || view.config.playerTrades) && (
            <TradePanel view={view} seat={seat} act={(a) => void run(a)} busy={busy} />
          )}
          <PlayersPanel view={view} waiting={waiting} />
          {side}
          <Panel title="Game log" className="xl:hidden">
            <LogList view={view} />
          </Panel>
          <BankPanel view={view} />
          {seat !== null && view.phase !== 'ended' && (
            <button type="button"
              onClick={() => {
                if (window.confirm('Resign from this game? Your pieces stay on the board.')) void run({ type: 'resign' })
              }}
              className="self-start rounded-lg px-3 py-1.5 text-xs text-sea-200 hover:bg-white/5 hover:text-rose-200">
              Resign
            </button>
          )}
        </aside>
      </div>
    </div>
  )
}
