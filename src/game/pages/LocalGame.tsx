/**
 * A game on this device: you against bots, or pass-and-play. When more than
 * one person shares the screen, it goes blank between them so nobody sees
 * the next player's hand.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { applyAction } from '../engine/game'
import { cryptoRng, recordingRng } from '../engine/rng'
import { waitingOn } from '../engine/rules'
import { redact } from '../engine/view'
import type { Action, GameState } from '../engine/types'
import { loadLocalGame, saveLocalGame, type LocalGame } from '../net/local'
import { GameScreen } from '../ui/GameScreen'
import { PLAYER_HEX } from '../ui/labels'
import { Swatch } from '../ui/panels'
import { useBotDriver } from '../ui/useBotDriver'

export function LocalGamePage() {
  const { id = '' } = useParams()
  const [game, setGame] = useState<LocalGame | null>(() => loadLocalGame(id))
  // Bots and the player both act on the newest state, even between renders.
  const latest = useRef<LocalGame | null>(null)
  useEffect(() => {
    latest.current = game
  }, [game])

  const humans = game?.humans ?? []
  const humanSeats = humans.flatMap((h, i) => (h ? [i] : []))
  const shared = humanSeats.length > 1

  // Whose eyes are on the screen: the person the game is waiting for, else
  // whoever last had it. Sharing a screen, it stays covered until they say so.
  const [chosen, setChosen] = useState<number | null>(null)
  const [revealed, setRevealed] = useState<number | null>(shared ? null : humanSeats[0] ?? null)
  const needed = game ? waitingOn(game.state).find((s) => humans[s]) : undefined
  const viewer = needed ?? chosen ?? revealed ?? humanSeats[0] ?? null
  const covered = shared && viewer !== null && viewer !== revealed

  const apply = useCallback(async (action: Action, seat: number) => {
    const current = latest.current ?? game
    if (!current) return
    const rng = recordingRng(cryptoRng)
    const state = applyAction(current.state, seat, action, { rng, now: Date.now() })
    const next = { ...current, state, moves: current.moves ? [...current.moves, { seat, action, draws: rng.draws }] : undefined }
    latest.current = next
    setGame(next)
    saveLocalGame(next)
  }, [game])

  useBotDriver({
    state: game?.state ?? null,
    isBot: (seat) => !humans[seat],
    submit: async (action, seat, expectedSeq) => {
      if ((latest.current ?? game)?.state.seq !== expectedSeq) {
        const stale = new Error('stale')
        stale.name = 'StaleError'
        throw stale
      }
      await apply(action, seat)
    },
    enabled: !!game && game.state.phase !== 'ended',
    delay: 650,
    timeoutSeat: null,
  })

  const view = game ? redact(game.state, viewer) : null

  if (!game || !view) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="font-display text-3xl font-bold">No game here</h1>
        <p className="mt-3 text-sea-100/70">This game isn't saved on this device.</p>
        <Link to="/play" className="mt-8 inline-block rounded-xl bg-sea-400 px-5 py-3 font-display font-semibold text-sea-950">
          Back to the lobby
        </Link>
      </div>
    )
  }

  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <Link to="/play" className="text-sm text-sea-200 hover:text-white">← Lobby</Link>
      <h1 className="font-display text-xl font-bold">{game.state.config.title}</h1>
      <span className="text-sm text-sea-200">on this device</span>
      {shared && (
        <div className="ml-auto flex items-center gap-1 text-xs">
          <span className="text-sea-200">Hand over to</span>
          {humanSeats.map((s) => (
            <button key={s} type="button" onClick={() => setChosen(s)}
              className={`flex items-center gap-1 rounded-md px-2 py-1 ${viewer === s ? 'bg-white/15' : 'bg-white/5 hover:bg-white/10'}`}>
              <Swatch color={PLAYER_HEX[game.state.players[s].color]} className="h-2.5 w-2.5" />
              {game.state.players[s].name}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <>
      <GameScreen view={view} seat={viewer} act={(action) => apply(action, viewer!)} header={header}
        replayHref={game.moves ? `/play/replay/local/${game.id}` : undefined} />
      {covered && viewer !== null && (
        <Handover state={game.state} seat={viewer} onReady={() => { setRevealed(viewer); setChosen(null) }} />
      )}
    </>
  )
}

function Handover({ state, seat, onReady }: { state: GameState; seat: number; onReady: () => void }) {
  const p = state.players[seat]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-sea-950/95 backdrop-blur-lg">
      <div className="flex flex-col items-center gap-5 px-6 text-center">
        <Swatch color={PLAYER_HEX[p.color]} className="h-10 w-10" />
        <h2 className="font-display text-3xl font-bold">Pass to {p.name}</h2>
        <p className="max-w-sm text-sea-100/70">Your hand is hidden until you're ready.</p>
        <button type="button" onClick={onReady} autoFocus
          className="rounded-xl bg-sea-400 px-6 py-3 font-display text-lg font-bold text-sea-950">
          I'm {p.name} — show me
        </button>
      </div>
    </div>
  )
}
