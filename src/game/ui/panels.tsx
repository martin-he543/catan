/** The side panels of the game screen. */
import { useEffect, useRef, type ReactNode } from 'react'
import { BARBARIAN_TRACK } from '../engine/config'
import { PROGRESS_INFO, knightStrength } from '../engine/ck'
import { longestRoute } from '../engine/placement'
import { pieceCounts, publicPoints, totalPoints, targetFor } from '../engine/state'
import { cardCount, devCount, fishCount, progressCount, type GameView } from '../engine/view'
import { CARDS, RESOURCES, COMMODITIES, TRACKS, type ProgressCardType } from '../engine/types'
import { asState } from './util'
import { CardChip, HandView } from './cards'
import { DEV_LABEL, DEV_TEXT, PLAYER_HEX, TRACK_BUILDINGS, TRACK_COLOR, TRACK_LABEL, TRACK_PERK } from './labels'

export function Panel({ title, children, right, className = '' }: { title: string; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`panel p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold tracking-wide text-sea-200 uppercase">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

export function Swatch({ color, className = 'h-3.5 w-3.5' }: { color: string; className?: string }) {
  return <span className={`inline-block shrink-0 rounded-[4px] border border-black/40 ${className}`} style={{ backgroundColor: color }} aria-hidden />
}

function Badge({ children, tone = 'amber' }: { children: ReactNode; tone?: 'amber' | 'sky' | 'rose' }) {
  const cls = tone === 'amber' ? 'bg-amber-300 text-amber-950' : tone === 'sky' ? 'bg-sky-300 text-sky-950' : 'bg-rose-300 text-rose-950'
  return <span className={`rounded-full px-1.5 py-0.5 text-[0.65rem] font-semibold ${cls}`}>{children}</span>
}

/* ------------------------------------------------------------------ *
 * Players
 * ------------------------------------------------------------------ */

export function PlayersPanel({ view, waiting }: { view: GameView; waiting: number[] }) {
  const state = asState(view)
  const ck = view.config.citiesKnights
  const strength = ck ? knightStrength(state) : []
  return (
    <Panel title="Players">
      <ul className="flex flex-col gap-2">
        {view.players.map((p, i) => {
          const mine = i === view.viewer
          const shown = mine || view.phase === 'ended' ? totalPoints(state, i) : publicPoints(state, i)
          const counts = pieceCounts(state, i)
          const turn = view.phase === 'main' && view.turn.seat === i
          const second = view.turn.stage.kind !== 'main' && view.turn.stage.seat === i
          return (
            <li
              key={i}
              className={`rounded-xl border px-3 py-2 text-sm transition ${turn || second ? 'border-sea-400 bg-sea-400/10' : 'border-white/10 bg-white/5'} ${p.resigned ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center gap-2">
                <Swatch color={PLAYER_HEX[p.color]} />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {p.name}
                  {p.bot && <span className="ml-1 text-xs font-normal text-sea-200">bot</span>}
                  {mine && <span className="ml-1 text-xs font-normal text-sea-200">you</span>}
                </span>
                {waiting.includes(i) && <span className="h-2 w-2 animate-pulse rounded-full bg-amber-300" title="Waiting on them" />}
                <span className="font-display text-lg font-bold tabular-nums" title={`${targetFor(state, i)} to win`}>
                  {shown}
                  <span className="ml-0.5 text-[0.65rem] font-semibold text-sea-200">/{targetFor(state, i)}</span>
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-sea-100/80">
                <span title="Cards in hand">🂠 {cardCount(p)}</span>
                {!ck && <span title="Development cards">🎴 {devCount(p)}</span>}
                {ck && <span title="Progress cards">📜 {progressCount(p)}</span>}
                {!ck && <span title="Knights played">⚔️ {p.knightsPlayed}</span>}
                {ck && <span title="Active knight strength">🛡️ {strength[i]}</span>}
                <span title="Longest road">🛣️ {longestRoute(state, i)}</span>
                <span title="Settlements / cities">🏠 {counts.settlements} · 🏰 {counts.cities}</span>
                {view.config.fishermen && <span title="Fish tokens">🐟 {fishCount(p)}</span>}
                {p.hasBoot && <span title="Holds the old boot: needs one more point">👢</span>}
                {p.islandPoints > 0 && <span title="Island bonus points">🏝️ {p.islandPoints}</span>}
                {!mine && view.phase !== 'ended' && p.hidden && p.hidden.dev > 0 && !ck && (
                  <span className="text-sea-200/60" title="Some development cards may be victory points">+?</span>
                )}
              </div>
              {(view.longestRoad?.owner === i || view.largestArmy?.owner === i || view.merchant?.owner === i || p.defenderPoints > 0 || p.progressPoints > 0 || counts.metropolises > 0) && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {view.longestRoad?.owner === i && <Badge>Longest road</Badge>}
                  {!ck && view.largestArmy?.owner === i && <Badge>Largest army</Badge>}
                  {view.merchant?.owner === i && <Badge tone="sky">Merchant</Badge>}
                  {p.defenderPoints > 0 && <Badge tone="sky">Defender ×{p.defenderPoints}</Badge>}
                  {p.progressPoints > 0 && <Badge tone="sky">Progress VP ×{p.progressPoints}</Badge>}
                  {TRACKS.filter((t) => view.metropolis[t] !== null && view.buildings[view.metropolis[t]!]?.owner === i).map((t) => (
                    <Badge key={t} tone="rose">{TRACK_LABEL[t]} metropolis</Badge>
                  ))}
                </div>
              )}
              {ck && (
                <div className="mt-1.5 grid grid-cols-3 gap-1">
                  {TRACKS.map((t) => (
                    <div key={t} className="flex items-center gap-1" title={`${TRACK_LABEL[t]} ${p.improvements[t]}`}>
                      {Array.from({ length: 5 }, (_, l) => (
                        <span key={l} className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: l < p.improvements[t] ? TRACK_COLOR[t] : 'rgba(255,255,255,0.12)' }} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

/* ------------------------------------------------------------------ *
 * Your hand
 * ------------------------------------------------------------------ */

interface HandProps {
  view: GameView
  seat: number
  canPlayDev: (card: string) => boolean
  onPlayDev: (card: 'knight' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly') => void
  canPlayProgress: (card: ProgressCardType) => boolean
  onPlayProgress: (card: ProgressCardType) => void
}

export function HandPanel({ view, seat, canPlayDev, onPlayDev, canPlayProgress, onPlayProgress }: HandProps) {
  const p = view.players[seat]
  const ck = view.config.citiesKnights
  return (
    <Panel title="Your hand" right={<span className="text-xs text-sea-200">{CARDS.reduce((s, c) => s + p.hand[c], 0)} cards</span>}>
      <HandView hand={p.hand} cards={ck ? [...RESOURCES, ...COMMODITIES] : RESOURCES} />

      {!ck && p.dev.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-sea-200 uppercase">Development cards</h3>
          {p.dev.map((d, i) => {
            const fresh = d.bought >= view.turn.number && view.phase === 'main'
            const playable = d.type !== 'victory' && canPlayDev(d.type)
            return (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5 text-sm">
                <span className="flex-1">
                  <span className="font-semibold">{DEV_LABEL[d.type]}</span>
                  {fresh && <span className="ml-1 text-xs text-sea-200">new</span>}
                  <span className="block text-xs text-sea-100/60">{DEV_TEXT[d.type]}</span>
                </span>
                {d.type !== 'victory' && (
                  <button
                    type="button"
                    disabled={!playable}
                    onClick={() => onPlayDev(d.type as 'knight')}
                    className="rounded-lg bg-sea-400 px-2.5 py-1 text-xs font-semibold text-sea-950 disabled:opacity-30"
                  >
                    Play
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {ck && p.progress.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-sea-200 uppercase">Progress cards ({p.progress.length}/4)</h3>
          {p.progress.map((c, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5 text-sm">
              <Swatch color={TRACK_COLOR[c.track]} className="h-3 w-1.5" />
              <span className="flex-1">
                <span className="font-semibold">{PROGRESS_INFO[c.type].title}</span>
                <span className="block text-xs text-sea-100/60">{PROGRESS_INFO[c.type].text}</span>
              </span>
              {c.type !== 'alchemist' && (
                <button
                  type="button"
                  disabled={!canPlayProgress(c.type)}
                  onClick={() => onPlayProgress(c.type)}
                  className="rounded-lg bg-sea-400 px-2.5 py-1 text-xs font-semibold text-sea-950 disabled:opacity-30"
                >
                  Play
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {view.config.fishermen && p.fish.length > 0 && (
        <p className="mt-3 text-sm">
          <span className="text-sea-200">Fish:</span>{' '}
          {p.fish.map((f, i) => (
            <span key={i} className="mr-1 rounded-md bg-sky-300/20 px-1.5 py-0.5 text-xs">{'🐟'.repeat(f)}</span>
          ))}
        </p>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ *
 * Cities & Knights: barbarians and improvements
 * ------------------------------------------------------------------ */

export function BarbarianTrack({ view }: { view: GameView }) {
  const state = asState(view)
  const b = view.barbarian
  if (!b) return null
  const strength = knightStrength(state).reduce((s, n) => s + n, 0)
  const cities = view.players.reduce((s, _, i) => s + pieceCounts(state, i).cities, 0)
  return (
    <div className="panel p-3">
      <div className="flex items-center justify-between text-xs text-sea-200">
        <span className="font-display font-semibold tracking-wide uppercase">Barbarians</span>
        <span>
          Knights <b className="text-sea-50">{strength}</b> vs cities <b className="text-sea-50">{cities}</b>
          {b.attacks === 0 && ' · robber asleep'}
        </span>
      </div>
      <div className="mt-2 flex gap-1" aria-label={`Barbarian ship ${b.position} of ${BARBARIAN_TRACK}`}>
        {Array.from({ length: BARBARIAN_TRACK + 1 }, (_, i) => (
          <span
            key={i}
            className={`flex h-7 flex-1 items-center justify-center rounded-md text-sm ${i === BARBARIAN_TRACK ? 'bg-rose-500/30' : 'bg-white/10'}`}
          >
            {i === b.position ? '⛵' : i === BARBARIAN_TRACK ? '🏰' : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

export function ImprovementsHelp() {
  return (
    <ul className="mt-2 space-y-1 text-xs text-sea-100/60">
      {TRACKS.map((t) => (
        <li key={t}>
          <span style={{ color: TRACK_COLOR[t] }}>{TRACK_LABEL[t]}</span>: {TRACK_BUILDINGS[t].join(' → ')}. {TRACK_PERK[t]}
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ *
 * Bank
 * ------------------------------------------------------------------ */

export function BankPanel({ view }: { view: GameView }) {
  const ck = view.config.citiesKnights
  return (
    <Panel title="Bank">
      <div className="flex flex-wrap gap-1.5">
        {(ck ? [...RESOURCES, ...COMMODITIES] : RESOURCES).map((c) => (
          <CardChip key={c} card={c} count={view.bank[c]} dim={view.bank[c] === 0} />
        ))}
      </div>
      <p className="mt-2 text-xs text-sea-200">
        {!ck && <>Development cards left: {view.decks.dev}. </>}
        {ck && <>Progress decks: {TRACKS.map((t) => `${TRACK_LABEL[t]} ${view.decks.progress[t]}`).join(' · ')}. </>}
        {view.config.fishermen && <>Fish tokens left: {view.decks.fish}. </>}
        {view.config.dice === 'balanced' && <>Dice deck: {view.diceDeck.length} of 36 left.</>}
      </p>
    </Panel>
  )
}

/* ------------------------------------------------------------------ *
 * Log
 * ------------------------------------------------------------------ */

export function LogList({ view }: { view: GameView }) {
  const end = useRef<HTMLLIElement>(null)
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [view.log.length])
  return (
    <ol className="max-h-72 space-y-1 overflow-y-auto pr-1 text-xs leading-relaxed">
      {view.log.map((entry, i) => {
        const color = entry.seat !== null ? PLAYER_HEX[view.players[entry.seat]?.color ?? 'white'] : undefined
        return (
          <li key={i} className="flex gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color ?? 'transparent' }} />
            <span className="text-sea-100/85">
              {entry.text}
              {entry.dice && <span className="ml-1 text-sea-200">🎲 {entry.dice.a}+{entry.dice.b}</span>}
              {entry.secret && <span className="ml-1 text-amber-200">({entry.secret.text})</span>}
            </span>
          </li>
        )
      })}
      <li ref={end} />
    </ol>
  )
}

/* ------------------------------------------------------------------ *
 * The end
 * ------------------------------------------------------------------ */

export function Standings({ view }: { view: GameView }) {
  const state = asState(view)
  const ranked = view.players
    .map((p, i) => ({ p, i, points: totalPoints(state, i) }))
    .sort((a, b) => b.points - a.points)
  return (
    <ol className="space-y-1.5">
      {ranked.map(({ p, i, points }, rank) => {
        const c = pieceCounts(state, i)
        const vp = p.dev.filter((d) => d.type === 'victory').length
        const parts = [
          c.settlements && `${c.settlements} settlement${c.settlements > 1 ? 's' : ''}`,
          c.cities && `${c.cities} cit${c.cities > 1 ? 'ies' : 'y'} (${c.cities * 2})`,
          c.metropolises && `${c.metropolises} metropolis (+${c.metropolises * 2})`,
          view.longestRoad?.owner === i && 'longest road (2)',
          !view.config.citiesKnights && view.largestArmy?.owner === i && 'largest army (2)',
          vp && `${vp} VP card${vp > 1 ? 's' : ''}`,
          p.progressPoints && `${p.progressPoints} progress VP`,
          p.defenderPoints && `${p.defenderPoints} defender`,
          p.islandPoints && `${p.islandPoints} island`,
          view.merchant?.owner === i && 'merchant (1)',
        ].filter(Boolean)
        return (
          <li key={i} className="flex items-start gap-3 rounded-xl bg-white/5 px-3 py-2">
            <span className="font-display text-lg font-bold text-sea-200">{rank + 1}</span>
            <Swatch color={PLAYER_HEX[p.color]} className="mt-1.5 h-3.5 w-3.5" />
            <span className="flex-1">
              <span className="font-semibold">{p.name}</span>
              <span className="block text-xs text-sea-100/60">{parts.join(', ') || 'no points'}</span>
            </span>
            <span className="font-display text-xl font-bold tabular-nums">{points}</span>
          </li>
        )
      })}
    </ol>
  )
}
