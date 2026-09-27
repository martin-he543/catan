/**
 * Set up a new game: choose a mode, the table and the house rules, and
 * optionally a board brought over from the board generator, Position or
 * Import — then play it here or online.
 */
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { MODES, configFor, modeById, type ModeGroup } from '../engine/config'
import { createGame, generateMapFor } from '../engine/game'
import type { GeneratedMap } from '../engine/maps'
import { cryptoRng, seededRng } from '../engine/rng'
import { redact } from '../engine/view'
import { PLAYER_COLORS, type GameConfig } from '../engine/types'
import { boardFromParams, boardFromText, importProblems, mapFromBoard, startFromBoard, type ImportedBoard } from '../importBoard'
import { isConfigured } from '../net/firebase'
import { newLocalId, saveLocalGame } from '../net/local'
import { createOnlineGame } from '../net/online'
import { GameBoard } from '../ui/GameBoard'
import { PLAYER_HEX } from '../ui/labels'
import { Swatch } from '../ui/panels'
import { rememberedName, rememberName } from './names'

const GROUPS: ModeGroup[] = ['Base game', 'Seafarers', 'Cities & Knights', 'Fishermen', 'Custom modes']

const TIMERS = [0, 60, 90, 120, 180, 300]

const SOURCE_LABEL: Record<ImportedBoard['source'], string> = {
  generator: 'the board generator',
  position: 'the Position page',
  import: 'Import Catan',
  notation: 'pasted notation',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      {children}
    </section>
  )
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-sea-400" />
      <span>
        {label}
        {hint && <span className="block text-xs text-sea-200/70">{hint}</span>}
      </span>
    </label>
  )
}

export function CreateGame() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const online = isConfigured()

  const [board, setBoard] = useState<ImportedBoard | null>(() => boardFromParams(params))
  const [pasted, setPasted] = useState('')
  const [pasteStatus, setPasteStatus] = useState<string | null>(null)
  const [modeId, setModeId] = useState('classic')
  const picked = modeById(modeId) ?? MODES[0]
  // Boards from other pages only fit the modes that play on the standard island.
  const mode = board && !picked.acceptsBoard ? MODES[0] : picked
  const positionSeats = board?.seats?.some((s) => s.settlements.length || s.cities.length || s.roads.length)
    ? board.seats.length
    : null
  const [players, setPlayers] = useState(positionSeats ?? mode.defaultPlayers)
  const [overrides, setOverrides] = useState<Partial<GameConfig>>({})
  const [where, setWhere] = useState<'local' | 'online'>(online ? 'online' : 'local')
  const [visibility, setVisibility] = useState<'public' | 'private'>('private')
  const [name, setName] = useState(rememberedName)
  const [seats, setSeats] = useState(() =>
    Array.from({ length: 8 }, (_, i) => ({ bot: i > 0, name: i === 0 ? '' : `Bot ${i + 1}` })),
  )
  const [previewSeed, setPreviewSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const modes = board ? MODES.filter((m) => m.acceptsBoard) : MODES

  const minPlayers = positionSeats ?? mode.minPlayers
  const maxPlayers = positionSeats ?? (board ? Math.min(4, mode.maxPlayers) : mode.maxPlayers)
  const count = Math.min(maxPlayers, Math.max(minPlayers, players))

  const config = useMemo(() => configFor(mode.id, count, overrides), [mode.id, count, overrides])
  const set = <K extends keyof GameConfig>(key: K, value: GameConfig[K]) => setOverrides((o) => ({ ...o, [key]: value }))

  const problems = board ? importProblems(board) : []

  const preview: GeneratedMap | null = useMemo(() => {
    const rng = seededRng(previewSeed)
    if (board) return problems.length ? null : mapFromBoard(board, { fishermen: config.fishermen, rng })
    return generateMapFor(config, { rng, now: 0 })
  }, [board, problems.length, config, previewSeed])

  const start = board && !problems.length ? startFromBoard(board, count) : undefined
  const openingIgnored = !!board?.opening?.length && count !== 4

  const previewView = useMemo(() => {
    if (!preview) return null
    const state = createGame(
      {
        config,
        seats: PLAYER_COLORS.slice(0, count).map((color, i) => ({ name: `Seat ${i + 1}`, color, bot: true })),
        map: preview,
        start,
      },
      { rng: seededRng(1), now: 0 },
    )
    // The host shouldn't see under the fog or a face-down island either.
    return redact(state, null)
  }, [preview, config, count, start])

  // Fog and face-down tiles must stay secret from the host when a server referees.
  const secretMap = config.veil !== 'none' || preview?.map.hexes.some((h) => h.veil === 'fog')

  const choose = (id: string) => {
    const next = modeById(id)!
    setModeId(id)
    setOverrides({})
    if (!positionSeats) setPlayers(next.defaultPlayers)
  }

  const loadPasted = () => {
    const { board: b, message } = boardFromText(pasted)
    setPasteStatus(message)
    if (b) setBoard(b)
  }

  const create = async () => {
    setBusy(true)
    setError(null)
    rememberName(name)
    try {
      const seatList = seats.slice(0, count).map((s, i) => ({
        bot: i > 0 && s.bot,
        name: i === 0 ? name || 'Player 1' : s.bot ? s.name || `Bot ${i + 1}` : s.name,
      }))
      if (where === 'local') {
        const state = createGame(
          {
            config,
            seats: seatList.map((s, i) => ({ name: s.name || `Player ${i + 1}`, color: PLAYER_COLORS[i], bot: s.bot })),
            map: preview ?? undefined,
            start,
          },
          { rng: cryptoRng, now: Date.now() },
        )
        const id = newLocalId()
        saveLocalGame({
          id, createdAt: Date.now(), updatedAt: Date.now(), mode: mode.id, state,
          humans: seatList.map((s) => !s.bot), initial: state, moves: [],
        })
        navigate(`/play/local/${id}`)
      } else {
        const code = await createOnlineGame({
          mode: mode.id,
          config,
          setup: board || !secretMap ? { map: preview ?? undefined, start } : undefined,
          boardFrom: board ? SOURCE_LABEL[board.source] : undefined,
          visibility,
          hostName: name || 'Host',
          seats: seatList,
        })
        navigate(`/play/g/${code}`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-8 lg:px-8">
      <header>
        <p className="font-display text-sm tracking-[0.2em] text-sea-200 uppercase">
          <Link to="/play" className="hover:text-white">Play</Link> · New game
        </p>
        <h1 className="mt-2 font-display text-4xl font-bold sm:text-5xl">Set up the table</h1>
        {board && (
          <p className="mt-4 max-w-2xl text-lg text-sea-100/80">
            Playing the board from {SOURCE_LABEL[board.source]}
            {positionSeats ? `, starting from its position with ${positionSeats} players` : ''}
            {board.opening?.length && !openingIgnored ? ', with its opening settlements already down' : ''}.{' '}
            <button type="button" className="underline underline-offset-2 hover:text-white" onClick={() => setBoard(null)}>
              Use a random board instead
            </button>
          </p>
        )}
      </header>

      <div className="flex flex-col gap-10 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-10">
          <Section title="Mode">
            {GROUPS.map((group) => {
              const list = modes.filter((m) => m.group === group)
              if (!list.length) return null
              return (
                <div key={group}>
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-sea-200 uppercase">{group}</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {list.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={m.id === mode.id}
                        onClick={() => choose(m.id)}
                        className={`rounded-xl border px-3 py-2.5 text-left transition ${
                          m.id === mode.id ? 'border-sea-400 bg-sea-400/15' : 'border-white/10 bg-white/5 hover:bg-white/10'
                        }`}
                      >
                        <span className="flex items-center justify-between font-display font-semibold">
                          {m.title}
                          <span className="text-xs font-normal text-sea-200">
                            {m.minPlayers === m.maxPlayers ? m.minPlayers : `${m.minPlayers}–${m.maxPlayers}`} players
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-sea-200">{m.blurb}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </Section>

          <Section title="The table">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-sea-200">Players</span>
              <div className="panel flex gap-1 p-1">
                {Array.from({ length: maxPlayers - minPlayers + 1 }, (_, i) => minPlayers + i).map((n) => (
                  <button key={n} type="button" onClick={() => setPlayers(n)} aria-pressed={n === count}
                    className={`rounded-lg px-3 py-1.5 text-sm ${n === count ? 'bg-sea-400 font-semibold text-sea-950' : 'hover:bg-white/10'}`}>
                    {n}
                  </button>
                ))}
              </div>
              {openingIgnored && <span className="text-xs text-amber-200">The generator's opening is for four players, so it is left off.</span>}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-sea-200">Play</span>
              <div className="panel flex gap-1 p-1">
                <button type="button" onClick={() => setWhere('online')} disabled={!online} aria-pressed={where === 'online'}
                  className={`rounded-lg px-3 py-1.5 text-sm disabled:opacity-40 ${where === 'online' ? 'bg-sea-400 font-semibold text-sea-950' : 'hover:bg-white/10'}`}>
                  Online
                </button>
                <button type="button" onClick={() => setWhere('local')} aria-pressed={where === 'local'}
                  className={`rounded-lg px-3 py-1.5 text-sm ${where === 'local' ? 'bg-sea-400 font-semibold text-sea-950' : 'hover:bg-white/10'}`}>
                  On this device
                </button>
              </div>
              {!online && (
                <span className="text-xs text-sea-200/80">
                  Online play needs Firebase — <Link to="/play" className="underline">set it up</Link>.
                </span>
              )}
            </div>

            <ol className="flex flex-col gap-2">
              {Array.from({ length: count }, (_, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                  <Swatch color={PLAYER_HEX[PLAYER_COLORS[i]]} className="h-4 w-4" />
                  {i === 0 ? (
                    <input value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} placeholder="Your name"
                      className="min-w-0 flex-1 rounded-lg bg-black/30 px-2 py-1 text-sm" aria-label="Your name" />
                  ) : (
                    <>
                      <div className="flex gap-1 text-xs">
                        <button type="button" aria-pressed={!seats[i].bot}
                          onClick={() => setSeats((s) => s.map((x, j) => (j === i ? { ...x, bot: false, name: '' } : x)))}
                          className={`rounded-md px-2 py-1 ${!seats[i].bot ? 'bg-white/20' : 'bg-white/5 text-sea-200'}`}>
                          {where === 'online' ? 'Friend' : 'Person'}
                        </button>
                        <button type="button" aria-pressed={seats[i].bot}
                          onClick={() => setSeats((s) => s.map((x, j) => (j === i ? { ...x, bot: true, name: `Bot ${i + 1}` } : x)))}
                          className={`rounded-md px-2 py-1 ${seats[i].bot ? 'bg-white/20' : 'bg-white/5 text-sea-200'}`}>
                          Bot
                        </button>
                      </div>
                      {where === 'local' || seats[i].bot ? (
                        <input value={seats[i].name}
                          onChange={(e) => setSeats((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value.slice(0, 24) } : x)))}
                          placeholder={`Player ${i + 1}`}
                          className="min-w-0 flex-1 rounded-lg bg-black/30 px-2 py-1 text-sm" aria-label={`Seat ${i + 1} name`} />
                      ) : (
                        <span className="flex-1 text-sm text-sea-200">Open — a friend joins with the link</span>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ol>
            {where === 'local' && seats.slice(1, count).filter((s) => !s.bot).length > 0 && (
              <p className="text-xs text-sea-200">Pass-and-play: the screen hides each hand until the next player takes the device.</p>
            )}
            {where === 'online' && (
              <div className="flex items-center gap-3 text-sm">
                <span className="text-sea-200">Listed</span>
                <div className="panel flex gap-1 p-1">
                  {(['private', 'public'] as const).map((v) => (
                    <button key={v} type="button" onClick={() => setVisibility(v)} aria-pressed={visibility === v}
                      className={`rounded-lg px-3 py-1 ${visibility === v ? 'bg-sea-400 font-semibold text-sea-950' : 'hover:bg-white/10'}`}>
                      {v === 'private' ? 'Link only' : 'In the open lobby'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Section>

          <Section title="House rules">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex items-center justify-between gap-3 text-sm">
                Points to win
                <input type="number" min={3} max={30} value={config.vpTarget}
                  onChange={(e) => set('vpTarget', Math.max(3, Math.min(30, Number(e.target.value) || 10)))}
                  className="w-20 rounded-lg bg-black/30 px-2 py-1 text-right" />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                Discard on a 7 above
                <input type="number" min={3} max={20} value={config.discardLimit}
                  onChange={(e) => set('discardLimit', Math.max(3, Math.min(20, Number(e.target.value) || 7)))}
                  className="w-20 rounded-lg bg-black/30 px-2 py-1 text-right" />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                Dice
                <select value={config.dice} onChange={(e) => set('dice', e.target.value as GameConfig['dice'])}
                  className="rounded-lg bg-black/30 px-2 py-1">
                  <option value="random">Random</option>
                  <option value="balanced">Balanced (a deck of 36 rolls)</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                Turn timer
                <select value={config.turnTimer} onChange={(e) => set('turnTimer', Number(e.target.value))}
                  className="rounded-lg bg-black/30 px-2 py-1">
                  {TIMERS.map((t) => <option key={t} value={t}>{t === 0 ? 'Off' : `${t / 60 >= 1 ? `${t / 60} min` : `${t} s`}`}</option>)}
                </select>
              </label>
              {count >= 5 && (
                <label className="flex items-center justify-between gap-3 text-sm sm:col-span-2">
                  Between turns
                  <select value={config.largeGameTurns} onChange={(e) => set('largeGameTurns', e.target.value as GameConfig['largeGameTurns'])}
                    className="rounded-lg bg-black/30 px-2 py-1">
                    <option value="secondSettler">Second settler: the player opposite builds and trades with the bank</option>
                    <option value="specialBuild">Special build phase: everyone builds in turn</option>
                    <option value="none">Nothing</option>
                  </select>
                </label>
              )}
              <Toggle label="Friendly robber" checked={config.friendlyRobber} onChange={(v) => set('friendlyRobber', v)}
                hint="The robber can't block anyone on two visible points or fewer." />
              <Toggle label="Balanced sevens" checked={config.balancedSevens} onChange={(v) => set('balancedSevens', v)}
                hint="With balanced dice, 7s are shared out evenly between players." />
              <Toggle label="Player trades" checked={config.playerTrades} onChange={(v) => set('playerTrades', v)} />
              {!mode.config.fishermen && (
                <Toggle label="Add Fishermen" checked={config.fishermen} onChange={(v) => set('fishermen', v)}
                  hint="The desert becomes a lake, with fishing grounds round the coast." />
              )}
              {!mode.config.dustBowl && (
                <Toggle label="Add Dust Bowl" checked={config.dustBowl} onChange={(v) => set('dustBowl', v)}
                  hint="Every 7 spreads the desert." />
              )}
              <label className="flex items-center justify-between gap-3 text-sm">
                Hidden island
                <select value={config.veil} onChange={(e) => set('veil', e.target.value as GameConfig['veil'])}
                  className="rounded-lg bg-black/30 px-2 py-1">
                  <option value="none">Face up</option>
                  <option value="blind">Blind placement</option>
                  <option value="terrain">Numbers only</option>
                </select>
              </label>
              {config.seafarers && (
                <label className="flex items-center justify-between gap-3 text-sm">
                  New island bonus
                  <input type="number" min={0} max={4} value={config.islandBonus}
                    onChange={(e) => set('islandBonus', Math.max(0, Math.min(4, Number(e.target.value) || 0)))}
                    className="w-20 rounded-lg bg-black/30 px-2 py-1 text-right" />
                </label>
              )}
            </div>
          </Section>
        </div>

        <aside className="flex w-full flex-col gap-4 lg:w-[26rem] lg:shrink-0">
          <div className="panel p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold tracking-wide text-sea-200 uppercase">Board</h2>
              {!board && (
                <button type="button" onClick={() => setPreviewSeed(Math.floor(Math.random() * 1e9))}
                  className="rounded-lg bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20">
                  Shuffle
                </button>
              )}
            </div>
            {previewView ? (
              <GameBoard view={previewView} />
            ) : (
              <p className="text-sm text-amber-100">That board isn't finished: {problems.join('; ')}.</p>
            )}
            {where === 'online' && secretMap && !board && (
              <p className="mt-2 text-xs text-sea-200">Hidden tiles are dealt fresh when the game starts.</p>
            )}
          </div>

          <details className="panel px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">Use a board from another page</summary>
            <p className="mt-2 text-xs text-sea-200">
              Paste a link from the <Link to="/board" className="underline">board generator</Link>,{' '}
              <Link to="/position" className="underline">Position</Link> or{' '}
              <Link to="/import" className="underline">Import Catan</Link>, or Catan notation. Each of those pages also
              has a button that brings its board straight here.
            </p>
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={3} spellCheck={false}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 p-2 font-mono text-xs"
              placeholder="https://…/position?b=…" />
            <button type="button" onClick={loadPasted}
              className="mt-1 rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10">
              Load it
            </button>
            {pasteStatus && <p className="mt-2 text-xs text-sea-100">{pasteStatus}</p>}
          </details>

          {error && <p role="alert" className="rounded-xl bg-rose-500/15 px-4 py-2 text-sm text-rose-100">{error}</p>}
          <button type="button" onClick={create} disabled={busy || !preview}
            className="rounded-xl bg-sea-400 px-5 py-3 font-display text-lg font-bold text-sea-950 transition hover:brightness-110 disabled:opacity-50">
            {busy ? 'Setting up…' : where === 'online' ? 'Create the table' : 'Start playing'}
          </button>
          <p className="text-xs text-sea-200">
            {mode.title} · {count} players · {config.vpTarget} points to win
            {config.citiesKnights && ' · Cities & Knights'}
            {config.seafarers && ' · Seafarers'}
            {config.fishermen && ' · Fishermen'}
          </p>
        </aside>
      </div>
    </div>
  )
}
