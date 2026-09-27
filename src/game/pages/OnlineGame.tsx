/**
 * An online game: the waiting room while seats fill, then the table.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { modeById } from '../engine/config'
import { PLAYER_COLORS, type Action, type GameState, type PlayerColor } from '../engine/types'
import {
  deleteGame,
  joinGame,
  leaveSeat,
  sendChat,
  setColor,
  setSeat,
  startGame,
  submitAction,
  watchChat,
  watchGame,
  type ChatDoc,
  type Live,
} from '../net/online'
import { GameScreen } from '../ui/GameScreen'
import { PLAYER_HEX } from '../ui/labels'
import { Panel, Swatch } from '../ui/panels'
import { useBotDriver } from '../ui/useBotDriver'
import { rememberedName, rememberName } from './names'

function useLive(code: string) {
  const [live, setLive] = useState<Live | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    watchGame(
      code,
      (next) => {
        setLive(next)
        setLoaded(true)
      },
      (e) => setError(e.message),
    )
      .then((unsubscribe) => {
        if (cancelled) unsubscribe()
        else stop = unsubscribe
      })
      .catch((e: Error) => {
        setError(e.message)
        setLoaded(true)
      })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [code])
  return { live, error, loaded }
}

function CopyLink({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          window.prompt('Copy this link', url)
        }
      }}
      className="rounded-xl bg-sea-400 px-4 py-2 font-display font-semibold text-sea-950 hover:brightness-110"
    >
      {copied ? 'Copied' : label}
    </button>
  )
}

function Chat({ code, name, seat }: { code: string; name: string; seat: number | null }) {
  const [messages, setMessages] = useState<Array<ChatDoc & { id: string }>>([])
  const [text, setText] = useState('')
  useEffect(() => {
    let stop: (() => void) | undefined
    watchChat(code, setMessages).then((s) => (stop = s)).catch(() => {})
    return () => stop?.()
  }, [code])
  return (
    <Panel title="Chat">
      <ol className="max-h-48 space-y-1 overflow-y-auto text-sm">
        {messages.map((m) => (
          <li key={m.id}>
            <b>{m.name}:</b> <span className="text-sea-100/85">{m.text}</span>
          </li>
        ))}
        {messages.length === 0 && <li className="text-xs text-sea-200/70">Say hello.</li>}
      </ol>
      {seat !== null && <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          void sendChat(code, name, seat, text)
          setText('')
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="Message"
          className="min-w-0 flex-1 rounded-lg bg-black/30 px-2 py-1 text-sm" aria-label="Chat message" />
        <button type="submit" className="rounded-lg bg-white/10 px-3 py-1 text-sm hover:bg-white/20">Send</button>
      </form>}
    </Panel>
  )
}

export function OnlineGamePage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const { live, error, loaded } = useLive(code)
  const [name, setName] = useState(rememberedName)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const game = live?.game ?? null
  const seat = live?.seat ?? null
  const uid = live?.uid ?? ''
  const isHost = !!game && game.hostUid === uid
  const url = `${window.location.origin}${import.meta.env.BASE_URL}play/g/${code}`.replace(/([^:]\/)\/+/g, '$1')

  const guard = useCallback(async (work: () => Promise<unknown>) => {
    setBusy(true)
    setProblem(null)
    try {
      await work()
    } catch (e) {
      setProblem((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  // Bots are played by the browsers at the table in client-authority games
  // (the server plays them otherwise). Either way, a seated browser calls
  // time when someone's clock runs out; the referee checks the deadline.
  const humanUids = game ? game.seatUids.filter(Boolean) : []
  const rank = humanUids.indexOf(uid)
  const clientRefereed = game?.authority === 'client'
  useBotDriver({
    state: live?.state ?? ((live?.view as unknown as GameState | null) ?? null),
    isBot: (s) => clientRefereed && !!game?.seats[s]?.bot,
    submit: (action, botSeat, expectedSeq) =>
      submitAction(code, game?.authority ?? 'client', action, clientRefereed ? { seat: botSeat, expectedSeq } : { expectedSeq }),
    enabled: !!game && game.status === 'playing' && rank >= 0,
    delay: 900 + Math.max(0, rank) * 2500,
    timeoutSeat: seat,
  })

  const act = useCallback(
    (action: Action) => submitAction(code, game?.authority ?? 'client', action, {}),
    [code, game?.authority],
  )

  const mode = game ? modeById(game.mode) : null
  const header = useMemo(
    () =>
      game && (
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/play" className="text-sm text-sea-200 hover:text-white">← Lobby</Link>
          <h1 className="font-display text-xl font-bold">{game.title}</h1>
          <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-sm tracking-widest">{code}</span>
          <span className="text-xs text-sea-200">
            {game.authority === 'server' ? 'Refereed by the server' : 'Refereed in the browser'}
            {seat === null && ' · watching'}
          </span>
        </div>
      ),
    [game, code, seat],
  )

  if (!loaded) return <p className="px-4 py-24 text-center text-sea-200">Connecting…</p>
  if (error && !game) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="font-display text-3xl font-bold">Couldn't open that game</h1>
        <p className="mt-3 text-sea-100/70">{error}</p>
        <Link to="/play" className="mt-8 inline-block rounded-xl bg-sea-400 px-5 py-3 font-display font-semibold text-sea-950">Back to the lobby</Link>
      </div>
    )
  }
  if (!game) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="font-display text-3xl font-bold">No game {code}</h1>
        <p className="mt-3 text-sea-100/70">Check the code, or start a new table.</p>
        <Link to="/play" className="mt-8 inline-block rounded-xl bg-sea-400 px-5 py-3 font-display font-semibold text-sea-950">Back to the lobby</Link>
      </div>
    )
  }

  if (game.status !== 'lobby' && live?.view) {
    return (
      <GameScreen
        view={live.view}
        seat={seat}
        act={act}
        header={header}
        replayHref={`/play/replay/g/${code}`}
        side={<Chat code={code} name={seat !== null ? game.seats[seat].name : name || 'Guest'} seat={seat} />}
      />
    )
  }
  if (game.status !== 'lobby') return <p className="px-4 py-24 text-center text-sea-200">Dealing the board…</p>

  const open = game.seats.some((s) => !s.uid && !s.bot)
  const c = game.config

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 lg:px-8">
      {header}
      <div className="panel flex flex-wrap items-center gap-4 p-5">
        <div className="flex-1">
          <p className="text-sm text-sea-200">Invite friends with the link or the code</p>
          <p className="mt-1 font-mono text-3xl font-bold tracking-[0.3em]">{code}</p>
        </div>
        <CopyLink url={url} label="Copy invite link" />
      </div>

      <Panel title={`Seats (${game.seats.length})`}>
        <ol className="flex flex-col gap-2">
          {game.seats.map((s, i) => {
            const mine = s.uid === uid
            return (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                <Swatch color={PLAYER_HEX[s.color]} className="h-4 w-4" />
                <span className="flex-1 text-sm">
                  {s.bot ? <>{s.name} <span className="text-xs text-sea-200">bot</span></>
                    : s.uid ? <>{s.name || 'Player'} {mine && <span className="text-xs text-sea-200">you</span>} {i === 0 && <span className="text-xs text-sea-200">host</span>}</>
                    : <span className="text-sea-200">Open seat</span>}
                </span>
                {(mine || isHost) && (
                  <select value={s.color} aria-label="Colour"
                    onChange={(e) => guard(() => setColor(code, i, e.target.value as PlayerColor))}
                    className="rounded-md bg-black/30 px-1 py-0.5 text-xs">
                    {PLAYER_COLORS.map((col) => <option key={col} value={col}>{col}</option>)}
                  </select>
                )}
                {isHost && i > 0 && (
                  <>
                    {!s.bot && <button type="button" disabled={busy} onClick={() => guard(() => setSeat(code, i, 'bot'))} className="rounded-md bg-white/10 px-2 py-0.5 text-xs hover:bg-white/20">Bot</button>}
                    {(s.bot || s.uid) && <button type="button" disabled={busy} onClick={() => guard(() => setSeat(code, i, 'open'))} className="rounded-md bg-white/10 px-2 py-0.5 text-xs hover:bg-white/20">Open</button>}
                    <button type="button" disabled={busy || game.seats.length <= 2} onClick={() => guard(() => setSeat(code, i, 'remove'))} className="rounded-md bg-white/10 px-2 py-0.5 text-xs hover:bg-white/20">Remove</button>
                  </>
                )}
              </li>
            )
          })}
        </ol>
        {isHost && game.seats.length < (mode?.maxPlayers ?? 8) && (
          <button type="button" disabled={busy} onClick={() => guard(() => setSeat(code, 0, 'add'))}
            className="mt-2 rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10">
            Add a seat
          </button>
        )}

        {seat === null && open && (
          <form className="mt-4 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              rememberName(name)
              void guard(() => joinGame(code, name || 'Player'))
            }}>
            <input value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} placeholder="Your name"
              className="rounded-lg bg-black/30 px-3 py-2 text-sm" aria-label="Your name" />
            <button type="submit" disabled={busy} className="rounded-xl bg-sea-400 px-4 py-2 font-display font-semibold text-sea-950">
              Take a seat
            </button>
          </form>
        )}
        {seat !== null && !isHost && (
          <button type="button" disabled={busy} onClick={() => guard(() => leaveSeat(code))}
            className="mt-3 rounded-lg px-3 py-1.5 text-sm text-sea-200 hover:bg-white/5">
            Leave my seat
          </button>
        )}
      </Panel>

      <Panel title="Rules">
        <p className="text-sm text-sea-100/80">
          {game.title} · {c.vpTarget} points to win · discard above {c.discardLimit}
          {c.friendlyRobber && ' · friendly robber'}
          {c.dice === 'balanced' && ' · balanced dice'}
          {c.balancedSevens && ' · balanced 7s'}
          {c.fishermen && ' · Fishermen'}
          {c.dustBowl && ' · Dust Bowl'}
          {c.veil === 'blind' && ' · blind placement'}
          {c.veil === 'terrain' && ' · numbers only'}
          {c.turnTimer > 0 && ` · ${c.turnTimer}s turns`}
          {game.seats.length >= 5 && c.largeGameTurns !== 'none' && ` · ${c.largeGameTurns === 'secondSettler' ? 'second settler' : 'special build phase'}`}
          {game.boardFrom && ` · board from ${game.boardFrom}`}
        </p>
      </Panel>

      {problem && <p role="alert" className="rounded-xl bg-rose-500/15 px-4 py-2 text-sm text-rose-100">{problem}</p>}

      {isHost ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy || open} onClick={() => guard(() => startGame(code))}
            className="rounded-xl bg-sea-400 px-6 py-3 font-display text-lg font-bold text-sea-950 disabled:opacity-40">
            Start the game
          </button>
          {open && <span className="text-sm text-sea-200">Waiting for every seat to fill — or make the open seats bots.</span>}
          <button type="button" disabled={busy}
            onClick={() => window.confirm('Close this table?') && guard(async () => { await deleteGame(code); navigate('/play') })}
            className="ml-auto rounded-lg px-3 py-1.5 text-sm text-sea-200 hover:bg-white/5 hover:text-rose-200">
            Close the table
          </button>
        </div>
      ) : (
        <p className="text-sm text-sea-200">Waiting for the host to start.</p>
      )}
    </div>
  )
}
