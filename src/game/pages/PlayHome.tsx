/**
 * The lobby: start a game, join one by code, pick up where you left off.
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ensureUser,
  firebaseSettings,
  isConfigured,
  parseSettings,
  saveSettings,
  settingsSource,
  signInWithGoogle,
  signOut,
} from '../net/firebase'
import { deleteLocalGame, listLocalGames, type LocalGame } from '../net/local'
import { watchLists, type GameDoc } from '../net/online'
import { isCode } from '../net/protocol'
import { PLAYER_HEX } from '../ui/labels'
import { Panel, Swatch } from '../ui/panels'

const SETUP_DOC = 'https://github.com/martin-he543/catan/blob/main/FIREBASE_SETUP.md'

function FirebaseSetup({ onSaved }: { onSaved: () => void }) {
  const [text, setText] = useState('')
  const [authority, setAuthority] = useState<'client' | 'server'>('client')
  const [message, setMessage] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-sea-100/80">
        Online play runs on your own free Firebase project. Follow{' '}
        <a href={SETUP_DOC} target="_blank" rel="noreferrer" className="underline">FIREBASE_SETUP.md</a>{' '}
        once — about ten minutes — and either build the site with the settings, or paste the{' '}
        <code className="rounded bg-white/10 px-1">firebaseConfig</code> from the Firebase console here to try it
        in this browser straight away.
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} spellCheck={false}
        placeholder={'const firebaseConfig = {\n  apiKey: "…",\n  authDomain: "…",\n  projectId: "…",\n  appId: "…"\n}'}
        className="w-full rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs" />
      <label className="flex items-center gap-2 text-sm">
        Referee
        <select value={authority} onChange={(e) => setAuthority(e.target.value as 'client' | 'server')}
          className="rounded-lg bg-black/30 px-2 py-1">
          <option value="client">In the browser (free Spark plan)</option>
          <option value="server">Cloud Functions (Blaze plan, hidden hands)</option>
        </select>
      </label>
      <div className="flex items-center gap-3">
        <button type="button"
          onClick={() => {
            const parsed = parseSettings(text)
            if (!parsed) {
              setMessage("That doesn't look like a firebaseConfig — it needs at least apiKey and projectId.")
              return
            }
            saveSettings({ ...parsed, authority })
            setMessage('Saved in this browser.')
            onSaved()
          }}
          className="rounded-xl bg-sea-400 px-4 py-2 font-display font-semibold text-sea-950">
          Connect
        </button>
        {message && <span className="text-sm text-sea-100">{message}</span>}
      </div>
    </div>
  )
}

function GameRow({ game, uid }: { game: GameDoc; uid: string }) {
  const seat = game.seatUids.indexOf(uid)
  const yourTurn = seat >= 0 && game.status === 'playing' && game.waiting.includes(seat)
  return (
    <li>
      <Link to={`/play/g/${game.code}`} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2 text-sm transition hover:bg-white/10">
        <span className="font-mono tracking-widest text-sea-200">{game.code}</span>
        <span className="flex-1 truncate">
          <b>{game.title}</b>{' '}
          <span className="text-sea-200">
            {game.seats.map((s) => s.name || 'open').join(', ')}
          </span>
        </span>
        <span className="flex gap-0.5">
          {game.seats.map((s, i) => <Swatch key={i} color={PLAYER_HEX[s.color]} className="h-2.5 w-2.5" />)}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${yourTurn ? 'bg-amber-300 font-semibold text-amber-950' : 'bg-white/10 text-sea-200'}`}>
          {game.status === 'lobby' ? 'waiting' : game.status === 'ended' ? 'finished' : yourTurn ? 'your move' : 'playing'}
        </span>
      </Link>
    </li>
  )
}

export function PlayHome() {
  const navigate = useNavigate()
  const [configured, setConfigured] = useState(isConfigured)
  const [code, setCode] = useState('')
  const [lists, setLists] = useState<{ mine: GameDoc[]; open: GameDoc[] }>({ mine: [], open: [] })
  const [uid, setUid] = useState('')
  const [account, setAccount] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [local, setLocal] = useState<LocalGame[]>(listLocalGames)

  useEffect(() => {
    if (!configured) return
    let stop: (() => void) | undefined
    ensureUser()
      .then((user) => {
        setUid(user.uid)
        setAccount(user.isAnonymous ? null : user.email ?? user.displayName ?? 'Google account')
        return watchLists(setLists, (e) => setError(e.message))
      })
      .then((s) => (stop = s))
      .catch((e: Error) => setError(e.message))
    return () => stop?.()
  }, [configured])

  const join = (e: React.FormEvent) => {
    e.preventDefault()
    const clean = code.trim().toUpperCase()
    if (isCode(clean)) navigate(`/play/g/${clean}`)
    else setError('A game code is six letters and numbers.')
  }

  const source = settingsSource()

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-10 lg:px-8">
      <header>
        <p className="font-display text-sm tracking-[0.2em] text-sea-200 uppercase">Play</p>
        <h1 className="mt-2 font-display text-4xl font-bold sm:text-5xl">Play Catan online</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-sea-100/80">
          Full games with friends or bots — the base game from 1v1 to eight players, Seafarers' scenarios,
          Cities &amp; Knights, Fishermen, and custom modes like Dust Bowl and blind placement. Start from a random
          board, or bring one from the <Link to="/board" className="underline underline-offset-2">board generator</Link>,{' '}
          <Link to="/import" className="underline underline-offset-2">Import</Link> or{' '}
          <Link to="/position" className="underline underline-offset-2">Position</Link>.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Link to="/play/new" className="panel flex flex-col gap-2 p-5 transition hover:bg-white/10">
          <span className="font-display text-2xl font-bold">New game</span>
          <span className="text-sm text-sea-200">Choose a mode, invite friends or add bots.</span>
        </Link>
        <form onSubmit={join} className="panel flex flex-col gap-3 p-5">
          <span className="font-display text-2xl font-bold">Join a game</span>
          <div className="flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" maxLength={6}
              disabled={!configured} aria-label="Game code"
              className="w-36 rounded-lg bg-black/30 px-3 py-2 font-mono tracking-[0.3em] uppercase disabled:opacity-40" />
            <button type="submit" disabled={!configured} className="rounded-xl bg-sea-400 px-4 py-2 font-display font-semibold text-sea-950 disabled:opacity-40">
              Join
            </button>
          </div>
          {!configured && <span className="text-xs text-sea-200">Online play needs Firebase — see below.</span>}
        </form>
      </div>

      {error && <p role="alert" className="rounded-xl bg-rose-500/15 px-4 py-2 text-sm text-rose-100">{error}</p>}

      {configured && (
        <div className="grid gap-6 md:grid-cols-2">
          <Panel title="Your games">
            {lists.mine.length ? (
              <ul className="flex flex-col gap-2">{lists.mine.map((g) => <GameRow key={g.code} game={g} uid={uid} />)}</ul>
            ) : (
              <p className="text-sm text-sea-200/70">None yet.</p>
            )}
          </Panel>
          <Panel title="Open tables">
            {lists.open.length ? (
              <ul className="flex flex-col gap-2">{lists.open.map((g) => <GameRow key={g.code} game={g} uid={uid} />)}</ul>
            ) : (
              <p className="text-sm text-sea-200/70">No public tables waiting. Create one and list it in the open lobby.</p>
            )}
          </Panel>
        </div>
      )}

      {local.length > 0 && (
        <Panel title="On this device">
          <ul className="flex flex-col gap-2">
            {local.map((g) => (
              <li key={g.id} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2 text-sm">
                <Link to={`/play/local/${g.id}`} className="flex-1 hover:underline">
                  <b>{g.state.config.title}</b>{' '}
                  <span className="text-sea-200">
                    {g.state.players.map((p) => p.name).join(', ')} ·{' '}
                    {g.state.phase === 'ended' ? `${g.state.players[g.state.winner!].name} won` : `turn ${g.state.turn.number}`}
                  </span>
                </Link>
                {g.moves && g.state.phase === 'ended' && (
                  <Link to={`/play/replay/local/${g.id}`} className="rounded-md px-2 py-0.5 text-xs text-sea-200 hover:bg-white/10">
                    Replay
                  </Link>
                )}
                <button type="button" onClick={() => { deleteLocalGame(g.id); setLocal(listLocalGames()) }}
                  className="rounded-md px-2 py-0.5 text-xs text-sea-200 hover:bg-white/10">
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={configured ? 'Online play' : 'Set up online play'}>
        {configured ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-sea-100/80">
              Connected to <b>{firebaseSettings()?.projectId}</b>
              {source === 'browser' ? ' (settings saved in this browser)' : ''}. Games are refereed{' '}
              {firebaseSettings()?.authority === 'server' ? 'by Cloud Functions' : 'in the players’ browsers'}.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {account ? (
                <>
                  <span className="text-sea-200">Signed in as {account}</span>
                  <button type="button" onClick={() => signOut().then(() => window.location.reload())}
                    className="rounded-lg bg-white/10 px-3 py-1 hover:bg-white/20">Sign out</button>
                </>
              ) : (
                <>
                  <span className="text-sea-200">Playing as a guest on this browser.</span>
                  <button type="button"
                    onClick={() => signInWithGoogle().then((u) => setAccount(u.email ?? 'Google account')).catch((e: Error) => setError(e.message))}
                    className="rounded-lg bg-white/10 px-3 py-1 hover:bg-white/20">
                    Sign in with Google to play across devices
                  </button>
                </>
              )}
              {source === 'browser' && (
                <button type="button" onClick={() => { saveSettings(null); setConfigured(false) }}
                  className="rounded-lg px-3 py-1 text-sea-200 hover:bg-white/10">
                  Disconnect this browser
                </button>
              )}
            </div>
          </div>
        ) : (
          <FirebaseSetup onSaved={() => setConfigured(true)} />
        )}
      </Panel>
    </div>
  )
}
