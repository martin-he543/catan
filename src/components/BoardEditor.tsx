import { useCallback, useEffect, useMemo, useRef } from 'react'
import { HEX_CENTERS, SEA_CENTERS, VIEW, pctH, pctW, portsFor, toPercent } from '../lib/geometry'
import { HEX_LABELS } from '../lib/notation'
import { pips } from '../lib/analysis'
import {
  PASTEL_INK,
  RESOURCE_EMOJI,
  RESOURCE_PASTEL,
  isRedToken,
  tokenPastel,
} from '../lib/palette'
import { NO_NUMBER, NUMBER_SUPPLY, NUMBER_TOKENS, TILE_SUPPLY, tallyBoard, type TileGuess } from '../lib/vision'
import { HexTile } from './HexTile'
import { PortMarker, PortShifter } from './PortMarker'
import {
  PORT_LABELS,
  PORT_TYPES,
  RESOURCE_LABELS,
  TILE_TYPES,
  type PortType,
  type Tile,
  type TileType,
} from '../lib/types'

/** Terrains in the order the keyboard shortcuts spell them out. */
const TERRAIN_KEYS: Record<string, TileType> = {
  b: 'brick', l: 'lumber', o: 'ore', g: 'wheat', w: 'sheep', d: 'desert',
}

interface Props {
  tiles: Tile[]
  ports: PortType[]
  /** Per-port shoreline nudges; see `portsFor`. */
  portShifts?: number[]
  guesses: TileGuess[] | null
  selected: number | null
  onSelect: (index: number | null) => void
  onTile: (index: number, tile: Tile) => void
  onPort: (index: number, port: PortType) => void
  onShiftPorts: (shifts: number[] | undefined) => void
}

interface CounterProps {
  used: number
  total: number
  /** The terrain colour this counter stands for; left out for a plain chip. */
  tint?: string
  label: string
  /** Shown before the label; the emoji, when there is one. */
  badge?: string
  /** Dots under the label, for number tokens. */
  dots?: number
  /** Number tokens print their pips in red on a 6 or an 8. */
  dotsRed?: boolean
}

/**
 * One entry in the box tally.
 *
 * Full strength while there are still some of these to place, faded once the
 * box is empty of them, and outlined in red if the board uses more than it
 * should. The count is always spelled out, so the colour is decoration rather
 * than the message.
 */
function Counter({ used, total, tint, label, badge, dots, dotsRed }: CounterProps) {
  const state = used > total ? 'over' : used === total ? 'done' : 'open'
  const spent = state === 'done'

  return (
    <span
      className="inline-flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-xs
                 transition-colors"
      style={{
        backgroundColor: tint
          ? spent
            ? `color-mix(in oklab, ${tint} 16%, transparent)`
            : tint
          : 'rgba(255, 255, 255, 0.08)',
        color: tint ? (spent ? tint : PASTEL_INK) : undefined,
        opacity: spent ? 0.65 : 1,
        boxShadow: state === 'over' ? 'inset 0 0 0 2px #dc2626' : undefined,
      }}
      title={`${label}: ${used} of ${total} placed`}
    >
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        {badge && <span aria-hidden>{badge}</span>}
        <span>{label}</span>
        <span className="font-display font-semibold tabular-nums">
          {used}/{total}
        </span>
      </span>

      {dots !== undefined && (
        <span
          aria-hidden
          className="leading-none tracking-[0.12em]"
          style={{
            fontSize: '0.6rem',
            color: !tint ? (dotsRed ? '#f87171' : undefined)
              : spent ? 'inherit' : dotsRed ? '#b91c1c' : PASTEL_INK,
          }}
        >
          {'·'.repeat(dots)}
        </span>
      )}
    </span>
  )
}

/**
 * The board as a form: click a tile to select it, then set its terrain and its
 * number token. Detection fills in the terrain, so most of the work left is
 * typing eighteen numbers — which the keyboard handler below makes quick.
 */
export function BoardEditor({
  tiles, ports, portShifts, guesses, selected, onSelect, onTile, onPort, onShiftPorts,
}: Props) {
  const counts = useMemo(() => tallyBoard(tiles), [tiles])
  /** Half-typed two-digit numbers: pressing 1 waits to see if a 0, 1 or 2 follows. */
  const pendingTen = useRef(false)

  /** The next tile still missing a number, so typing can flow tile to tile. */
  const nextBlank = useCallback(
    (from: number) => {
      for (let i = 1; i <= tiles.length; i++) {
        const at = (from + i) % tiles.length
        if (tiles[at].blank || (tiles[at].type !== 'desert' && tiles[at].number === NO_NUMBER)) return at
      }
      return null
    },
    [tiles],
  )

  const setNumber = useCallback(
    (index: number, number: number) => {
      // Numbers go on terrain; a grey tile or the desert has nowhere to put one.
      if (tiles[index].blank || tiles[index].type === 'desert') return
      onTile(index, { ...tiles[index], number })
      const next = nextBlank(index)
      if (next !== null) onSelect(next)
    },
    [tiles, onTile, onSelect, nextBlank],
  )

  const setTerrain = useCallback(
    (index: number, type: TileType) => {
      // The desert never carries a token, and giving it one back is a mistake.
      // Nor does its placeholder 7 belong on whatever terrain replaces it.
      const kept = tiles[index].type === 'desert' || tiles[index].blank ? NO_NUMBER : tiles[index].number
      onTile(index, { type, number: type === 'desert' ? 7 : kept || NO_NUMBER })
    },
    [tiles, onTile],
  )

  useEffect(() => {
    if (selected === null) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target?.closest('input, textarea, select, [contenteditable]')) return

      const key = event.key.toLowerCase()

      if (key === 'escape') {
        onSelect(null)
        return
      }
      if (key === 'arrowright' || key === 'arrowdown') {
        event.preventDefault()
        onSelect((selected + 1) % tiles.length)
        return
      }
      if (key === 'arrowleft' || key === 'arrowup') {
        event.preventDefault()
        onSelect((selected - 1 + tiles.length) % tiles.length)
        return
      }
      if (TERRAIN_KEYS[key]) {
        event.preventDefault()
        setTerrain(selected, TERRAIN_KEYS[key])
        return
      }

      if (!/^\d$/.test(key)) return
      event.preventDefault()
      const digit = Number(key)

      if (pendingTen.current) {
        pendingTen.current = false
        // 1 then 0, 1 or 2 makes ten, eleven or twelve; anything else is dropped.
        if (digit <= 2) setNumber(selected, 10 + digit)
        return
      }
      if (digit === 1) {
        pendingTen.current = true
        return
      }
      if (digit >= 2) setNumber(selected, digit)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, tiles.length, onSelect, setNumber, setTerrain])

  const tile = selected === null ? null : tiles[selected]

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <PortShifter shifts={portShifts} onShift={onShiftPorts} />
      </div>
      <div
        className="relative mx-auto w-full max-w-4xl select-none"
        style={{ aspectRatio: `${VIEW.width} / ${VIEW.height}`, containerType: 'inline-size' }}
      >
        {SEA_CENTERS.map((center, i) => (
          <HexTile key={`sea-${i}`} center={center} sea />
        ))}

        {HEX_CENTERS.map((center, i) => (
          <HexTile key={`tile-${i}`} center={center} tile={tiles[i]} dimmed={selected !== null && selected !== i} />
        ))}

        {portsFor(portShifts).map((port, i) => {
          const { left, top } = toPercent(port.pos)
          return (
            <div key={`port-${i}`}>
              <PortMarker port={port} type={ports[i]} />
              <button
                type="button"
                onClick={() => onPort(i, PORT_TYPES[(PORT_TYPES.indexOf(ports[i]) + 1) % PORT_TYPES.length])}
                title={`${PORT_LABELS[ports[i]]} — click to change`}
                aria-label={`Port ${i + 1}: ${PORT_LABELS[ports[i]]}. Click to change.`}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full
                           transition hover:bg-white/20 focus-visible:bg-white/20"
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  width: `${pctW(0.5)}%`,
                  height: `${pctH(0.5)}%`,
                }}
              />
            </div>
          )
        })}

        {HEX_CENTERS.map((center, i) => {
          const { left, top } = toPercent(center)
          const unsure = guesses ? guesses[i].confidence < 0.35 : false
          return (
            <button
              key={`hit-${i}`}
              type="button"
              onClick={() => onSelect(selected === i ? null : i)}
              aria-label={`Tile ${HEX_LABELS[i]}: ${
                tiles[i].blank
                  ? 'no terrain yet'
                  : `${RESOURCE_LABELS[tiles[i].type]}${
                      tiles[i].type === 'desert' ? '' : `, ${tiles[i].number || 'no number yet'}`
                    }`
              }${unsure ? ', unsure' : ''}`}
              aria-pressed={selected === i}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition
                          ${selected === i ? 'ring-4 ring-sea-400' : 'hover:ring-2 hover:ring-white/40'}
                          ${unsure && selected !== i ? 'ring-2 ring-amber-400/70' : ''}`}
              style={{
                left: `${left}%`,
                top: `${top}%`,
                width: `${pctW(0.66)}%`,
                height: `${pctH(0.66)}%`,
              }}
            />
          )
        })}
      </div>

      <div className="panel p-4">
        {tile === null ? (
          <p className="text-sm text-sea-100/70">
            Click a tile to set what it is. With one selected you can type its number
            straight away, or press{' '}
            <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-xs">B</kbd>{' '}
            <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-xs">L</kbd>{' '}
            <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-xs">O</kbd>{' '}
            <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-xs">G</kbd>{' '}
            <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-xs">W</kbd>{' '}
            <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-xs">D</kbd> for its terrain.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-baseline gap-3">
              <span className="font-display text-lg font-bold">Tile {HEX_LABELS[selected!]}</span>
              {guesses && (
                <span className="text-xs text-sea-200">
                  read as {RESOURCE_LABELS[guesses[selected!].type]} ·{' '}
                  {Math.round(guesses[selected!].confidence * 100)}% sure
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {TILE_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setTerrain(selected!, type)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                              transition ${
                    tile.type === type && !tile.blank
                      ? 'bg-sea-400 font-semibold text-sea-950'
                      : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  <span aria-hidden>{RESOURCE_EMOJI[type]}</span>
                  {RESOURCE_LABELS[type]}
                </button>
              ))}
            </div>

            {tile.type !== 'desert' && !tile.blank && (
              <div className="flex flex-wrap gap-2">
                {NUMBER_TOKENS.map((number) => {
                  const chosen = tile.number === number
                  const spent = (counts.numbers[number] ?? 0) >= NUMBER_SUPPLY[number]
                  const tint = tokenPastel(number)
                  return (
                    <button
                      key={number}
                      type="button"
                      onClick={() => setNumber(selected!, number)}
                      aria-pressed={chosen}
                      title={`${number} · ${pips(number)} ways to roll it${spent ? ' · none left in the box' : ''}`}
                      className="flex w-11 flex-col items-center rounded-lg py-1 text-sm
                                 tabular-nums transition hover:brightness-110"
                      style={{
                        backgroundColor: chosen
                          ? tint
                          : `color-mix(in oklab, ${tint} ${spent ? 10 : 22}%, transparent)`,
                        color: chosen ? PASTEL_INK : tint,
                        fontWeight: chosen ? 700 : 400,
                        opacity: spent && !chosen ? 0.5 : 1,
                      }}
                    >
                      <span className="leading-tight">{number}</span>
                      <span
                        aria-hidden
                        className="leading-none tracking-[0.12em]"
                        style={{
                          fontSize: '0.55rem',
                          color: chosen && isRedToken(number) ? '#b91c1c' : undefined,
                        }}
                      >
                        {'·'.repeat(pips(number))}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="panel flex flex-col gap-3 p-4">
        <h3 className="font-display text-sm font-semibold text-sea-200">What is left in the box</h3>
        <div className="flex flex-wrap gap-1.5">
          {TILE_TYPES.map((type) => (
            <Counter
              key={type}
              used={counts.terrain[type]}
              total={TILE_SUPPLY[type]}
              tint={RESOURCE_PASTEL[type]}
              badge={RESOURCE_EMOJI[type]}
              label={RESOURCE_LABELS[type]}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {NUMBER_TOKENS.map((number) => (
            <Counter
              key={number}
              used={counts.numbers[number] ?? 0}
              total={NUMBER_SUPPLY[number]}
              label={String(number)}
              dots={pips(number)}
              dotsRed={isRedToken(number)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
