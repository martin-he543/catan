/**
 * Board pieces in SVG, in layout units (a hex is 1 wide).
 *
 * Settlements, cities, roads and the robber use the same photographed art as
 * the board generator and Position pages. The expansion pieces have no photo,
 * so they are drawn here in the same spirit: flat colour, a soft shadow and a
 * dark outline, tinted per player.
 */
import { pieceImage, robberImage } from '../../lib/assets'
import type { Point } from '../engine/hexgrid'
import type { PlayerColor, Track } from '../engine/types'
import { PLAYER_HEX, PLAYER_INK, TRACK_COLOR } from './labels'

/** The photographed pieces' footprint; matches PositionBoard. */
const PIECES = {
  settlement: { w: 0.28, h: 0.28, drop: 0.08 },
  city: { w: 0.37, h: 0.36, drop: 0.09 },
} as const
const ROAD_LENGTH = 0.4
const ROAD_WIDTH = ROAD_LENGTH * (72 / 270)
const ROBBER_H = 0.52
const ROBBER_W = ROBBER_H * (113 / 256)

export function ShadowDefs() {
  return (
    <defs>
      <filter id="piece-shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0.012" dy="0.018" stdDeviation="0.012" floodOpacity="0.55" />
      </filter>
      <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
        <feDropShadow dx="0" dy="0" stdDeviation="0.03" floodColor="#fff" floodOpacity="0.9" />
      </filter>
      <filter id="grey" x="-10%" y="-10%" width="120%" height="120%">
        <feColorMatrix type="saturate" values="0.35" />
      </filter>
      <clipPath id="hex-clip" clipPathUnits="objectBoundingBox">
        <polygon points="0.5,0 1,0.25 1,0.75 0.5,1 0,0.75 0,0.25" />
      </clipPath>
      <radialGradient id="unknown-land" cx="50%" cy="40%" r="70%">
        <stop offset="0%" stopColor="#a8a29e" />
        <stop offset="100%" stopColor="#57534e" />
      </radialGradient>
    </defs>
  )
}

interface PieceProps {
  at: Point
  color: PlayerColor
  ghost?: boolean
  className?: string
}

export function Building({ at, color, city, ghost, className }: PieceProps & { city: boolean }) {
  const { w, h, drop } = PIECES[city ? 'city' : 'settlement']
  return (
    <image
      href={pieceImage(city ? 'city' : 'settlement', color)}
      x={at.x - w / 2}
      y={at.y + drop - h}
      width={w}
      height={h}
      filter="url(#piece-shadow)"
      pointerEvents="none"
      opacity={ghost ? 0.65 : 1}
      className={className}
    />
  )
}

/** Stone ring under a city (Cities & Knights). */
export function Wall({ at }: { at: Point }) {
  return (
    <g pointerEvents="none" filter="url(#piece-shadow)">
      <path
        d={`M ${at.x - 0.2} ${at.y + 0.1} q 0.2 0.09 0.4 0 l 0 -0.05 q -0.2 0.08 -0.4 0 z`}
        fill="#9ca3af"
        stroke="#374151"
        strokeWidth={0.012}
      />
      {[-0.13, -0.04, 0.05, 0.14].map((dx) => (
        <rect key={dx} x={at.x + dx - 0.02} y={at.y + 0.055 + Math.abs(dx) * -0.08 + 0.02} width={0.04} height={0.03} fill="#6b7280" />
      ))}
    </g>
  )
}

/** A flag over a city that has become a metropolis. */
export function MetropolisFlag({ at, track }: { at: Point; track: Track }) {
  const x = at.x + 0.08
  const y = at.y - 0.34
  return (
    <g pointerEvents="none" filter="url(#piece-shadow)">
      <line x1={x} y1={y} x2={x} y2={y + 0.2} stroke="#1f2937" strokeWidth={0.015} />
      <path d={`M ${x} ${y} l 0.14 0.035 l -0.14 0.035 z`} fill={TRACK_COLOR[track]} stroke="#1f2937" strokeWidth={0.008} />
    </g>
  )
}

export function Road({ a, b, color, ghost, className }: { a: Point; b: Point; color: PlayerColor; ghost?: boolean; className?: string }) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI - 90
  return (
    <image
      href={pieceImage('road', color)}
      x={-ROAD_WIDTH / 2}
      y={-ROAD_LENGTH / 2}
      width={ROAD_WIDTH}
      height={ROAD_LENGTH}
      transform={`translate(${mid.x} ${mid.y}) rotate(${angle})`}
      filter="url(#piece-shadow)"
      pointerEvents="none"
      opacity={ghost ? 0.65 : 1}
      className={className}
    />
  )
}

/** A little ship, drawn along the edge it sails on. */
export function Ship({ a, b, color, ghost, className }: { a: Point; b: Point; color: PlayerColor; ghost?: boolean; className?: string }) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
  // Keep the sail upright-ish.
  if (angle > 90) angle -= 180
  if (angle < -90) angle += 180
  const fill = PLAYER_HEX[color]
  return (
    <g
      transform={`translate(${mid.x} ${mid.y}) rotate(${angle})`}
      filter="url(#piece-shadow)"
      pointerEvents="none"
      opacity={ghost ? 0.65 : 1}
      className={className}
    >
      <path d="M -0.17 0.01 L 0.17 0.01 L 0.12 0.075 L -0.12 0.075 Z" fill={fill} stroke="#1c1917" strokeWidth={0.014} />
      <line x1={0} y1={0.01} x2={0} y2={-0.17} stroke="#1c1917" strokeWidth={0.014} />
      <path d="M 0.012 -0.16 Q 0.12 -0.08 0.012 -0.01 Z" fill={fill} stroke="#1c1917" strokeWidth={0.012} />
      <path d="M -0.012 -0.13 Q -0.09 -0.07 -0.012 -0.02 Z" fill={fill} stroke="#1c1917" strokeWidth={0.012} opacity={0.85} />
    </g>
  )
}

export function Robber({ at }: { at: Point }) {
  return (
    <image
      href={robberImage}
      x={at.x + 0.27 - ROBBER_W / 2}
      y={at.y + 0.02 - ROBBER_H / 2}
      width={ROBBER_W}
      height={ROBBER_H}
      pointerEvents="none"
      filter="url(#piece-shadow)"
    />
  )
}

/** The black pirate ship (Seafarers). */
export function Pirate({ at }: { at: Point }) {
  return (
    <g transform={`translate(${at.x + 0.18} ${at.y + 0.05}) scale(1.6)`} filter="url(#piece-shadow)" pointerEvents="none">
      <path d="M -0.17 0.01 L 0.17 0.01 L 0.12 0.075 L -0.12 0.075 Z" fill="#111827" stroke="#000" strokeWidth={0.01} />
      <line x1={0} y1={0.01} x2={0} y2={-0.17} stroke="#000" strokeWidth={0.012} />
      <path d="M 0.01 -0.16 L 0.13 -0.1 L 0.01 -0.03 Z" fill="#1f2937" stroke="#000" strokeWidth={0.01} />
      <text x={0.055} y={-0.08} fontSize={0.06} textAnchor="middle" fill="#f9fafb">☠</text>
    </g>
  )
}

/** The Cities & Knights merchant pawn. */
export function Merchant({ at, color }: { at: Point; color: PlayerColor }) {
  const x = at.x - 0.27
  const y = at.y + 0.04
  return (
    <g filter="url(#piece-shadow)" pointerEvents="none">
      <path d={`M ${x - 0.07} ${y + 0.09} L ${x} ${y - 0.1} L ${x + 0.07} ${y + 0.09} Z`} fill={PLAYER_HEX[color]} stroke="#1c1917" strokeWidth={0.012} />
      <circle cx={x} cy={y - 0.12} r={0.045} fill={PLAYER_HEX[color]} stroke="#1c1917" strokeWidth={0.012} />
      <text x={x} y={y + 0.06} fontSize={0.07} textAnchor="middle" fill={PLAYER_INK[color]}>$</text>
    </g>
  )
}

/** A knight disc: strength in pips, bright when active. */
export function KnightPiece({ at, color, level, active, ghost, className }: PieceProps & { level: number; active: boolean }) {
  const r = 0.105
  return (
    <g
      pointerEvents="none"
      opacity={ghost ? 0.6 : 1}
      filter={active ? 'url(#glow)' : 'url(#piece-shadow)'}
      className={className}
    >
      <circle cx={at.x} cy={at.y} r={r} fill={PLAYER_HEX[color]} stroke={active ? '#fff' : '#1c1917'} strokeWidth={active ? 0.024 : 0.014} />
      <g filter={active ? undefined : 'url(#grey)'}>
        <text x={at.x} y={at.y + 0.035} fontSize={0.11} textAnchor="middle" fill={PLAYER_INK[color]}>♞</text>
      </g>
      {Array.from({ length: level }, (_, i) => (
        <circle
          key={i}
          cx={at.x + (i - (level - 1) / 2) * 0.05}
          cy={at.y + r + 0.035}
          r={0.02}
          fill={active ? '#fde047' : '#e5e7eb'}
          stroke="#1c1917"
          strokeWidth={0.008}
        />
      ))}
    </g>
  )
}
