import { pctH, pctW, toPercent, VERTICES } from '../lib/geometry'
import type { VertexReport } from '../lib/analysis'
import type { PlayerColor } from '../lib/types'

const SIZE = 0.2

const COLOR_STYLES: Record<PlayerColor, string> = {
  red: 'bg-player-red border-red-900',
  blue: 'bg-player-blue border-blue-900',
  yellow: 'bg-player-yellow border-yellow-800',
  white: 'bg-player-white border-slate-500',
}

interface Props {
  index: number
  owner?: PlayerColor
  /** First-round settlements get a heavier outline, as on the original site. */
  isFirstRound?: boolean
  clickable: boolean
  blocked: boolean
  report: VertexReport
  showRatings: boolean
  onSelect: (index: number) => void
  onHover: (index: number | null) => void
}

export function SettlementSpot({
  index,
  owner,
  isFirstRound,
  clickable,
  blocked,
  report,
  showRatings,
  onSelect,
  onHover,
}: Props) {
  const { left, top } = toPercent(VERTICES[index])

  const common = {
    left: `${left}%`,
    top: `${top}%`,
    width: `${pctW(SIZE)}%`,
    height: `${pctH(SIZE)}%`,
  }

  if (owner) {
    return (
      <div
        className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-[18%] border
                    shadow-[0_2px_5px_rgba(0,0,0,0.55)] ${COLOR_STYLES[owner]}
                    ${isFirstRound ? 'ring-2 ring-black/70' : ''}`}
        style={common}
        title={`${owner} · ${report.pips} pips`}
      />
    )
  }

  if (blocked) {
    // Too close to an existing settlement — show it, but greyed and inert.
    return (
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/30"
        style={{ ...common, width: `${pctW(SIZE * 0.5)}%`, height: `${pctH(SIZE * 0.5)}%` }}
        title="Too close to an existing settlement"
      />
    )
  }

  // Heat shading: strong corners glow amber, weak ones stay cool.
  const heat = report.rating / 100

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => onSelect(index)}
      onMouseEnter={() => onHover(index)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(index)}
      onBlur={() => onHover(null)}
      aria-label={`Corner ${index}: ${report.pips} pips, ${report.variety} resources${
        report.port ? `, ${report.port} port` : ''
      }`}
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border
                  transition-[transform,box-shadow,background-color] duration-150
                  ${clickable ? 'cursor-pointer hover:scale-150 focus-visible:scale-150' : 'cursor-default'}
                  ${showRatings ? 'border-black/25' : 'border-white/50'}
                  ${!showRatings && clickable ? 'animate-pulse' : ''}`}
      style={{
        ...common,
        backgroundColor: showRatings
          ? `color-mix(in oklab, #fbbf24 ${heat * 100}%, #0ea5e9)`
          : 'rgba(255,255,255,0.55)',
        boxShadow: showRatings
          ? `0 0 ${0.6 + heat * 1.2}rem rgba(251,191,36,${0.15 + heat * 0.55})`
          : undefined,
      }}
    />
  )
}
