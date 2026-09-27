/**
 * Step through a game move by move. Every action was stored with the random
 * numbers it drew, so re-applying them rebuilds each position exactly — with
 * every hand face up.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { applyAction } from '../engine/game'
import { replayRng } from '../engine/rng'
import { fullView } from '../engine/view'
import type { Action, GameState } from '../engine/types'
import { loadLocalGame } from '../net/local'
import { loadReplay } from '../net/online'
import { GameBoard } from '../ui/GameBoard'
import { DiceView } from '../ui/cards'
import { LogList, Panel, PlayersPanel, Standings } from '../ui/panels'

interface Recorded {
  initial: GameState
  moves: Array<{ seat: number; action: Action; draws: number[] }>
}

/** Far in the future, so recorded timeouts replay as expired. */
const LATE = 1e15

function positions(game: Recorded): GameState[] {
  const out = [game.initial]
  let state = game.initial
  for (const m of game.moves) {
    try {
      state = applyAction(state, m.seat, m.action, { rng: replayRng(m.draws), now: LATE })
    } catch {
      // A move that no longer applies (an older engine) ends the replay there.
      break
    }
    out.push(state)
  }
  return out
}

export function ReplayPage({ source }: { source: 'local' | 'online' }) {
  const { id = '' } = useParams()
  // Local games are right here; online ones are fetched.
  const local = source === 'local' ? loadLocalGame(id) : null
  const [game, setGame] = useState<Recorded | null>(() =>
    local?.initial && local.moves ? { initial: local.initial, moves: local.moves } : null,
  )
  const [error, setError] = useState<string | null>(() =>
    source === 'local' && !(local?.initial && local.moves) ? 'This game was saved before replays were recorded.' : null,
  )
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (source === 'local') return
    loadReplay(id)
      .then((r) => (r ? setGame(r) : setError('No replay for this game yet — it opens once the game ends.')))
      .catch((e: Error) => setError(e.message))
  }, [id, source])

  const states = useMemo(() => (game ? positions(game) : []), [game])
  const last = Math.max(0, states.length - 1)
  const at = Math.min(step, last)

  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setStep((s) => {
      if (s >= last) {
        setPlaying(false)
        return s
      }
      return s + 1
    }), 450)
    return () => clearInterval(t)
  }, [playing, last])

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="font-display text-3xl font-bold">No replay</h1>
        <p className="mt-3 text-sea-100/70">{error}</p>
        <Link to="/play" className="mt-8 inline-block rounded-xl bg-sea-400 px-5 py-3 font-display font-semibold text-sea-950">Back to the lobby</Link>
      </div>
    )
  }
  if (!states.length) return <p className="px-4 py-24 text-center text-sea-200">Loading the replay…</p>

  const view = fullView(states[at])
  const button = 'rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20 disabled:opacity-30'

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-3 py-4 sm:px-4 lg:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/play" className="text-sm text-sea-200 hover:text-white">← Lobby</Link>
        <h1 className="font-display text-xl font-bold">Replay · {view.config.title}</h1>
      </div>
      <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
        <button type="button" className={button} disabled={at === 0} onClick={() => setStep(0)} aria-label="First move">⏮</button>
        <button type="button" className={button} disabled={at === 0} onClick={() => setStep(at - 1)} aria-label="Back one">◀</button>
        <button type="button" className={button} onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</button>
        <button type="button" className={button} disabled={at === last} onClick={() => setStep(at + 1)} aria-label="Forward one">▶</button>
        <button type="button" className={button} disabled={at === last} onClick={() => setStep(last)} aria-label="Last move">⏭</button>
        <input type="range" min={0} max={last} value={at} onChange={(e) => setStep(Number(e.target.value))}
          className="min-w-40 flex-1 accent-sea-400" aria-label="Move" />
        <span className="text-sm tabular-nums text-sea-200">{at} / {last}</span>
        <DiceView dice={view.turn.dice} ck={view.config.citiesKnights} />
      </div>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="panel min-w-0 flex-1 overflow-hidden p-2 sm:p-3">
          <GameBoard view={view} />
        </div>
        <aside className="flex w-full flex-col gap-3 xl:w-[27rem] xl:shrink-0">
          {view.phase === 'ended' && <Panel title="Final scores"><Standings view={view} /></Panel>}
          <PlayersPanel view={view} waiting={[]} />
          <Panel title="Log"><LogList view={view} /></Panel>
        </aside>
      </div>
    </div>
  )
}
