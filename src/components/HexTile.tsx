import { HEX_H, HEX_W, pctH, pctW, toPercent, type Point } from '../lib/geometry'
import { tileImage } from '../lib/assets'
import { pips } from '../lib/analysis'
import type { Tile } from '../lib/types'

/** A pointy-top hexagon, clipped from the tile artwork. */
const HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'

interface Props {
  center: Point
  tile?: Tile
  dimmed?: boolean
  highlighted?: boolean
  /** Sea frame tiles are decorative and never carry a number. */
  sea?: boolean
}

export function HexTile({ center, tile, dimmed, highlighted, sea }: Props) {
  const { left, top } = toPercent(center)
  const type = sea ? 'sea' : (tile?.type ?? 'desert')
  const showToken = !sea && tile && tile.type !== 'desert'
  const isRed = tile?.number === 6 || tile?.number === 8

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 transition-opacity duration-300"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        // Overlap by a hair so no seams show between neighbouring hexes.
        width: `${pctW(HEX_W * 1.01)}%`,
        height: `${pctH(HEX_H * 1.01)}%`,
        opacity: dimmed ? 0.5 : 1,
      }}
    >
      <img
        src={tileImage(type)}
        alt=""
        draggable={false}
        className="h-full w-full object-cover select-none"
        style={{
          clipPath: HEX_CLIP,
          filter: highlighted ? 'brightness(1.18) saturate(1.15)' : undefined,
        }}
      />

      {showToken && (
        <div
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2
                     flex-col items-center justify-center rounded-full
                     bg-parchment text-slate-900 shadow-[0_2px_6px_rgba(0,0,0,0.45)]"
          style={{
            width: '40%',
            aspectRatio: '1',
            border: '0.18em solid var(--color-parchment-edge)',
            color: isRed ? '#b91c1c' : '#1c1917',
          }}
        >
          <span
            className="font-display font-bold leading-none"
            style={{ fontSize: 'clamp(0.6rem, 2.1cqw, 1.6rem)' }}
          >
            {tile.number}
          </span>
          <span
            className="leading-none tracking-[0.08em]"
            style={{ fontSize: 'clamp(0.3rem, 1.1cqw, 0.85rem)' }}
            aria-hidden
          >
            {'·'.repeat(pips(tile.number))}
          </span>
          <span className="sr-only">
            {pips(tile.number)} pips
          </span>
        </div>
      )}
    </div>
  )
}
