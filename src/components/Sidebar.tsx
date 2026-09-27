import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  GAME_TYPE_LABELS,
  PLACEMENT_ORDER,
  RESOURCE_LABELS,
  type GameType,
  type PlayerColor,
  type ResourceType,
} from '../lib/types'
import { playerTotals, type VertexReport } from '../lib/analysis'
import { asset } from '../lib/assets'

const SWATCH: Record<PlayerColor, string> = {
  red: 'bg-player-red',
  blue: 'bg-player-blue',
  yellow: 'bg-player-yellow',
  white: 'bg-player-white',
}

function CopyButton({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url)
          setCopied(true)
        } catch {
          // Clipboard can be unavailable (insecure origin, denied permission);
          // fall back to letting the user grab the link from the address bar.
          window.prompt('Copy this link', url)
        }
      }}
      className="flex w-full items-center justify-between rounded-lg bg-white/5 px-3 py-2
                 text-left text-sm transition hover:bg-white/10"
    >
      <span>{label}</span>
      <span className="text-xs text-sea-200">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

interface Props {
  gameType: GameType
  onGenerate: (type: GameType) => void
  boardUrl: string
  fullUrl: string
  locs: number[]
  reports: VertexReport[]
  onUndo: () => void
  onReset: () => void
  showRatings: boolean
  onToggleRatings: () => void
  onOpenDice: () => void
  hovered: number | null
}

export function Sidebar({
  gameType,
  onGenerate,
  boardUrl,
  fullUrl,
  locs,
  reports,
  onUndo,
  onReset,
  showRatings,
  onToggleRatings,
  onOpenDice,
  hovered,
}: Props) {
  const turn = locs.length
  const done = turn >= PLACEMENT_ORDER.length
  const current = done ? null : PLACEMENT_ORDER[turn]
  const preview = hovered === null ? null : reports[hovered]

  return (
    <aside className="flex w-full flex-col gap-5 lg:w-80 lg:shrink-0">
      <div className="panel p-4">
        <h2 className="font-display text-sm font-semibold tracking-wide text-sea-200 uppercase">
          Generate
        </h2>
        <div className="mt-3 flex flex-col gap-2">
          {(Object.keys(GAME_TYPE_LABELS) as GameType[]).map((type) => {
            const active = type === gameType
            return (
              <button
                key={type}
                type="button"
                onClick={() => onGenerate(type)}
                aria-pressed={active}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                  active
                    ? 'border-sea-400 bg-sea-400/15'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                <span className="flex items-center justify-between font-display font-semibold">
                  {GAME_TYPE_LABELS[type].title}
                  {active && <span className="text-xs text-sea-200">current</span>}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-sea-200">
                  {GAME_TYPE_LABELS[type].blurb}
                </span>
              </button>
            )
          })}
        </div>
        <p className="mt-3 hidden text-xs text-sea-200 lg:block">
          Press <kbd className="rounded bg-white/10 px-1">R</kbd> to reroll the current mode.
        </p>
      </div>

      <div className="panel p-4">
        <h2 className="font-display text-sm font-semibold tracking-wide text-sea-200 uppercase">
          Opening placement
        </h2>

        <p className="mt-3 flex items-center gap-2 text-sm">
          {current ? (
            <>
              <span className={`h-3.5 w-3.5 rounded-sm ${SWATCH[current]}`} />
              <span>
                <span className="capitalize">{current}</span> is placing
              </span>
              <span className="ml-auto text-xs text-sea-200">{turn + 1} of 8</span>
            </>
          ) : (
            <span className="text-sea-200">All eight settlements are down.</span>
          )}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onUndo}
            disabled={turn === 0}
            className="rounded-lg bg-white/5 px-3 py-2 text-sm transition hover:bg-white/10
                       disabled:opacity-40 disabled:hover:bg-white/5"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={turn === 0}
            className="rounded-lg bg-white/5 px-3 py-2 text-sm transition hover:bg-white/10
                       disabled:opacity-40 disabled:hover:bg-white/5"
          >
            Clear
          </button>
        </div>

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showRatings}
            onChange={onToggleRatings}
            className="accent-sea-400"
          />
          Shade corners by pip value
        </label>

        {locs.length > 0 && <PlayerTable locs={locs} reports={reports} />}
      </div>

      <div className="panel p-4">
        <h2 className="font-display text-sm font-semibold tracking-wide text-sea-200 uppercase">
          {preview ? 'Corner preview' : 'Hover a corner'}
        </h2>
        {preview ? (
          <div className="mt-3 text-sm">
            <p className="font-display text-2xl font-bold">
              {preview.pips} <span className="text-sm font-normal text-sea-200">pips</span>
            </p>
            <p className="text-xs text-sea-200">
              {preview.variety} resource{preview.variety === 1 ? '' : 's'}
              {preview.port && ` · ${preview.port === '31' ? '3:1' : `2:1 ${preview.port}`} port`}
            </p>
            <ul className="mt-2 space-y-1">
              {(Object.entries(preview.byResource) as [ResourceType, number][])
                .sort((a, b) => b[1] - a[1])
                .map(([resource, value]) => (
                  <li key={resource} className="flex items-center gap-2 text-xs">
                    <span className="w-16 text-sea-200">{RESOURCE_LABELS[resource]}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <span
                        className="block h-full rounded-full bg-sea-400"
                        style={{ width: `${(value / 15) * 100}%` }}
                      />
                    </span>
                    <span className="w-4 text-right tabular-nums">{value}</span>
                  </li>
                ))}
            </ul>
          </div>
        ) : (
          <p className="mt-2 text-xs leading-relaxed text-sea-200">
            Point at any corner to see what it produces. Brighter corners are stronger.
          </p>
        )}
      </div>

      <div className="panel p-4">
        <h2 className="font-display text-sm font-semibold tracking-wide text-sea-200 uppercase">
          Share &amp; reference
        </h2>
        <div className="mt-3 space-y-2">
          <Link
            to={`/play/new${fullUrl.slice(fullUrl.indexOf('?'))}`}
            className="block rounded-lg bg-sea-400 px-3 py-2 text-sm font-semibold text-sea-950 transition hover:brightness-110"
          >
            Play this board online
          </Link>
          <CopyButton label="Share board" url={boardUrl} />
          <CopyButton label="Share with placements" url={fullUrl} />
          <button
            type="button"
            onClick={onOpenDice}
            className="w-full rounded-lg bg-white/5 px-3 py-2 text-left text-sm transition hover:bg-white/10"
          >
            Roll the dice
          </button>
          <a
            href={asset('rules/base-game.jpg')}
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg bg-white/5 px-3 py-2 text-sm transition hover:bg-white/10"
          >
            Base game rules
          </a>
          <Link
            to="/"
            className="block rounded-lg bg-white/5 px-3 py-2 text-sm transition hover:bg-white/10"
          >
            Back to resources
          </Link>
        </div>
      </div>
    </aside>
  )
}

function PlayerTable({ locs, reports }: { locs: number[]; reports: VertexReport[] }) {
  const players = (['red', 'blue', 'yellow', 'white'] as PlayerColor[]).map((color) => {
    const vertices = locs.filter((_, i) => PLACEMENT_ORDER[i] === color)
    return { color, ...playerTotals(reports, vertices), count: vertices.length }
  })

  return (
    <table className="mt-4 w-full text-xs">
      <caption className="sr-only">Pip totals by player</caption>
      <thead className="text-sea-200">
        <tr>
          <th scope="col" className="pb-1 text-left font-medium">Player</th>
          <th scope="col" className="pb-1 text-right font-medium">Pips</th>
          <th scope="col" className="pb-1 text-right font-medium">Types</th>
        </tr>
      </thead>
      <tbody>
        {players
          .filter((p) => p.count > 0)
          .map((p) => (
            <tr key={p.color} className="border-t border-white/10">
              <th scope="row" className="py-1.5 text-left font-normal">
                <span className="flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-sm ${SWATCH[p.color]}`} />
                  <span className="capitalize">{p.color}</span>
                </span>
              </th>
              <td className="py-1.5 text-right font-display font-semibold tabular-nums">
                {p.pipTotal}
              </td>
              <td className="py-1.5 text-right tabular-nums text-sea-200">
                {Object.keys(p.totals).length}
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  )
}
